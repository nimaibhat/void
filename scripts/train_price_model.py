#!/usr/bin/env python3
"""Standalone XGBoost training script for ERCOT wholesale electricity price prediction.

Produces a trained sklearn Pipeline (StandardScaler + XGBRegressor) that the
Blackout API's price service can optionally load for ML-based forecasting.
If the API cannot find the .pkl file, it falls back to deterministic rules mode.

Usage:
    python scripts/train_price_model.py --data-source synthetic
    python scripts/train_price_model.py --data-source ercot --years 2
    python scripts/train_price_model.py --output-dir /custom/path/models

Output artifacts (saved to --output-dir):
    price_model.pkl            trained sklearn Pipeline (StandardScaler + XGBRegressor)
    price_model_metadata.json  training metadata (feature list, scores, data source)
    feature_importance.json    ranked XGBoost feature importance scores
    training_report.txt        human-readable summary
    price_model_eval.png       actual vs predicted chart highlighting extreme spikes
"""

from __future__ import annotations

import argparse
import json
import pickle
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Tuple

# ── Dependency check ──────────────────────────────────────────────────


def _check_deps() -> None:
    missing: List[str] = []
    for pkg, display in [
        ("numpy", "numpy"),
        ("pandas", "pandas"),
        ("matplotlib", "matplotlib"),
        ("sklearn", "scikit-learn"),
        ("xgboost", "xgboost"),
    ]:
        try:
            __import__(pkg)
        except ImportError:
            missing.append(display)
    if missing:
        print(f"ERROR: Missing packages: {', '.join(missing)}")
        print(f"Install with:  pip install {' '.join(missing)}")
        sys.exit(1)


_check_deps()

import numpy as np
import pandas as pd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBRegressor

# ── Constants ─────────────────────────────────────────────────────────

FEATURE_NAMES: List[str] = [
    "temperature_f",
    "wind_speed_mph",
    "hour_of_day",
    "day_of_week",
    "month",
    "is_weekend",
    "heating_degree_hours",
    "cooling_degree_hours",
    "demand_estimate_mw",
    "renewable_gen_pct",
    "grid_utilization_pct",
    "rolling_24h_avg_price",
    "rolling_24h_avg_temp",
    "temp_change_6h",
    "is_extreme_cold",
    "is_extreme_heat",
]

ERCOT_BASE_PRICE_MWH = 28.0
ERCOT_CAPACITY_MW = 85_000
ERCOT_WIND_PENETRATION = 0.25

TOD_PREMIUM: Dict[int, float] = {
    0: 0.70, 1: 0.65, 2: 0.60, 3: 0.58, 4: 0.58, 5: 0.62,
    6: 0.75, 7: 0.90, 8: 1.00, 9: 1.05, 10: 1.08, 11: 1.10,
    12: 1.12, 13: 1.15, 14: 1.18, 15: 1.20, 16: 1.25, 17: 1.35,
    18: 1.40, 19: 1.35, 20: 1.20, 21: 1.05, 22: 0.90, 23: 0.80,
}

CITIES = {
    "Austin": (30.27, -97.74),
    "Houston": (29.76, -95.37),
    "Dallas": (32.78, -96.80),
}

# ══════════════════════════════════════════════════════════════════════
#  SYNTHETIC DATA GENERATION
# ══════════════════════════════════════════════════════════════════════


def generate_synthetic_data() -> pd.DataFrame:
    """Generate 8,760 rows (1 year hourly) of realistic ERCOT-like data.

    Temperature follows seasonal + daily sinusoidal curves with Gaussian noise.
    Wind follows a Weibull distribution (shape=2, scale=10 mph).
    Prices follow a rules-based pattern correlated with temp and TOD.
    Includes a 3-day Uri-like extreme cold event with $2,000-$9,000 spikes.
    """
    t0 = time.time()
    print("[1/5] Generating synthetic training data (8,760 hours)...")

    rng = np.random.default_rng(42)
    hours = 8760
    timestamps = pd.date_range("2021-01-01", periods=hours, freq="h")
    hour_idx = np.arange(hours)

    # ── Temperature: seasonal + diurnal + noise ──
    day_of_year = hour_idx / 24.0
    seasonal = 67.0 + 28.0 * np.sin(2 * np.pi * (day_of_year - 110) / 365)
    diurnal = 15.0 * np.sin(2 * np.pi * (hour_idx % 24 - 15) / 24)
    noise = rng.normal(0, 3.5, hours)
    temperature_f = seasonal + diurnal + noise

    # Uri-like event: Feb 14-16 (day 44-47), extreme cold
    uri_start = 24 * 44  # hour 1056
    uri_end = uri_start + 72
    # Cold-front ramp leading in (day 43)
    ramp_start = uri_start - 24
    ramp = np.linspace(float(temperature_f[ramp_start]), 15.0, 24)
    temperature_f[ramp_start:uri_start] = ramp + rng.normal(0, 2, 24)
    temperature_f[uri_start:uri_end] = rng.uniform(-5, 12, uri_end - uri_start)

    # ── Wind: Weibull (shape=2, scale=10 mph) ──
    wind_speed_mph = rng.weibull(2.0, hours) * 10.0
    wind_speed_mph[uri_start:uri_end] = rng.uniform(1.0, 6.0, uri_end - uri_start)

    # ── Price generation (rules-based + stochastic noise) ──
    h_of_day = np.array([t.hour for t in timestamps])
    tod = np.array([TOD_PREMIUM.get(h, 1.0) for h in h_of_day])

    hdh = np.maximum(0.0, 65.0 - temperature_f)
    cdh = np.maximum(0.0, temperature_f - 75.0)
    temp_premium = hdh * 2.5 + cdh * 1.8
    wind_depression = np.maximum(0.3, 1.0 - wind_speed_mph * 0.015)

    price = (ERCOT_BASE_PRICE_MWH + temp_premium) * tod * wind_depression

    # Scarcity premium
    grid_util = np.minimum(1.0, 0.45 + (hdh * 0.008 + cdh * 0.006) * tod)
    scarcity = np.where(grid_util > 0.80, (grid_util - 0.80) ** 2 * 5000, 0.0)
    scarcity = scarcity + np.where(
        grid_util > 0.95, (grid_util - 0.95) * 20000, 0.0
    )
    price = price + scarcity

    # Uri price spikes: $2,000-$9,000
    uri_mask = (hour_idx >= uri_start) & (hour_idx < uri_end)
    uri_spike = rng.uniform(2000, 9000, hours)
    price = np.where(uri_mask, np.maximum(price, uri_spike), price)

    # Stochastic noise (±5%)
    price = price * (1.0 + rng.normal(0, 0.05, hours))
    price = np.maximum(-15.0, price)

    df = pd.DataFrame(
        {
            "timestamp": timestamps,
            "temperature_f": np.round(temperature_f, 1),
            "wind_speed_mph": np.round(wind_speed_mph, 1),
            "price_mwh": np.round(price, 2),
        }
    )

    elapsed = time.time() - t0
    uri_prices = df.loc[uri_mask, "price_mwh"]
    print(f"    Generated {len(df):,} rows in {elapsed:.1f}s")
    print(
        f"    Temp range: {df['temperature_f'].min():.0f}°F "
        f"to {df['temperature_f'].max():.0f}°F"
    )
    print(
        f"    Price range: ${df['price_mwh'].min():.2f} "
        f"to ${df['price_mwh'].max():.2f}/MWh"
    )
    print(f"    Uri event: {len(uri_prices)} hours, avg ${uri_prices.mean():.0f}/MWh")

    return df


# ══════════════════════════════════════════════════════════════════════
#  ERCOT HISTORICAL DATA
# ══════════════════════════════════════════════════════════════════════


def download_ercot_data(years: int) -> pd.DataFrame:
    """Download real weather from Open-Meteo + generate ERCOT-calibrated prices.

    Weather data is real historical data for Austin/Houston/Dallas.
    Prices are generated from a calibrated rules engine using the real weather,
    because ERCOT's historical SPP download portal requires manual navigation.

    For real ERCOT prices, download CSVs from https://www.ercot.com/mktinfo/prices
    and filter for HB_HUBAVG settlement point.
    """
    t0 = time.time()
    print(f"[1/5] Downloading ERCOT historical data ({years} years)...")

    try:
        import requests
    except ImportError:
        print("ERROR: 'requests' package required for ERCOT mode.")
        print("Install with:  pip install requests")
        sys.exit(1)

    end_year = 2021
    start_year = end_year - years + 1
    start_date = f"{start_year}-01-01"
    end_date = f"{end_year}-12-31"

    # ── Weather from Open-Meteo (free, no auth) ──
    print("  Downloading weather data from Open-Meteo...")
    all_weather: List[pd.DataFrame] = []

    for city_name, (lat, lon) in CITIES.items():
        url = (
            f"https://archive-api.open-meteo.com/v1/archive"
            f"?latitude={lat}&longitude={lon}"
            f"&start_date={start_date}&end_date={end_date}"
            f"&hourly=temperature_2m,wind_speed_10m"
            f"&temperature_unit=fahrenheit"
            f"&wind_speed_unit=mph"
            f"&timezone=America/Chicago"
        )
        try:
            resp = requests.get(url, timeout=120)
            resp.raise_for_status()
            data = resp.json()
        except requests.ConnectionError:
            print(f"\nERROR: Cannot connect to Open-Meteo API.")
            print("Check your internet connection and try again.")
            sys.exit(1)
        except requests.Timeout:
            print(f"\nERROR: Open-Meteo request timed out for {city_name}.")
            print("The API may be under heavy load. Try again in a few minutes.")
            sys.exit(1)
        except requests.HTTPError as e:
            print(f"\nERROR: Open-Meteo returned {e.response.status_code} for {city_name}.")
            print("The date range may be unsupported. Try reducing --years.")
            sys.exit(1)
        except Exception as e:
            print(f"\nERROR: Failed to download weather for {city_name}: {e}")
            sys.exit(1)

        hourly = data.get("hourly", {})
        if not hourly.get("time"):
            print(f"\nERROR: No hourly data returned for {city_name}.")
            print(f"URL: {url}")
            sys.exit(1)

        wdf = pd.DataFrame(
            {
                "timestamp": pd.to_datetime(hourly["time"]),
                f"temp_{city_name.lower()}": hourly["temperature_2m"],
                f"wind_{city_name.lower()}": hourly["wind_speed_10m"],
            }
        )
        all_weather.append(wdf)
        print(f"    {city_name}: {len(wdf):,} hours downloaded")

    # Merge city weather
    weather = all_weather[0]
    for wdf in all_weather[1:]:
        weather = weather.merge(wdf, on="timestamp", how="outer")

    # Average across cities
    temp_cols = [c for c in weather.columns if c.startswith("temp_")]
    wind_cols = [c for c in weather.columns if c.startswith("wind_")]
    weather["temperature_f"] = weather[temp_cols].mean(axis=1)
    weather["wind_speed_mph"] = weather[wind_cols].mean(axis=1)

    # ── Generate prices from weather (ERCOT-calibrated rules) ──
    print("  Generating ERCOT-calibrated prices from real weather patterns...")
    print("    NOTE: For actual ERCOT prices, download CSVs from:")
    print("      https://www.ercot.com/mktinfo/prices")
    print("    Filter for HB_HUBAVG hub average, resample 15-min → hourly.")

    weather = weather.sort_values("timestamp").reset_index(drop=True)
    h_of_day = weather["timestamp"].dt.hour
    tod = h_of_day.map(TOD_PREMIUM).fillna(1.0)

    hdh = np.maximum(0.0, 65.0 - weather["temperature_f"].values)
    cdh = np.maximum(0.0, weather["temperature_f"].values - 75.0)
    temp_premium = hdh * 2.5 + cdh * 1.8
    wind_dep = np.maximum(0.3, 1.0 - weather["wind_speed_mph"].values * 0.015)

    price = (ERCOT_BASE_PRICE_MWH + temp_premium) * tod.values * wind_dep

    grid_util = np.minimum(1.0, 0.45 + (hdh * 0.008 + cdh * 0.006) * tod.values)
    scarcity = np.where(grid_util > 0.80, (grid_util - 0.80) ** 2 * 5000, 0.0)
    scarcity = scarcity + np.where(
        grid_util > 0.95, (grid_util - 0.95) * 20000, 0.0
    )
    price = price + scarcity

    # Add noise calibrated to ERCOT volatility
    rng = np.random.default_rng(42)
    price = price * (1.0 + rng.normal(0, 0.08, len(price)))
    price = np.maximum(-15.0, price)

    df = pd.DataFrame(
        {
            "timestamp": weather["timestamp"],
            "temperature_f": weather["temperature_f"].round(1),
            "wind_speed_mph": weather["wind_speed_mph"].round(1),
            "price_mwh": np.round(price, 2),
        }
    )
    df = df.dropna().reset_index(drop=True)

    elapsed = time.time() - t0
    print(f"    Dataset: {len(df):,} rows in {elapsed:.1f}s")
    print(
        f"    Date range: {df['timestamp'].min().strftime('%Y-%m-%d')} "
        f"to {df['timestamp'].max().strftime('%Y-%m-%d')}"
    )

    return df


# ══════════════════════════════════════════════════════════════════════
#  SUPABASE + OPEN-METEO DATA (real ERCOT demand + real weather)
# ══════════════════════════════════════════════════════════════════════


def download_supabase_data() -> pd.DataFrame:
    """Pull real hourly demand from Supabase ercot_load + real weather from Open-Meteo.

    Joins on timestamp to create rich feature vectors.  Generates calibrated
    wholesale prices using the rules engine (since we don't have real ERCOT SPP
    data) but with real demand + weather inputs for realistic patterns.

    Supabase ercot_load table: 43,818 rows, 8 zones, 2021-2025.
    """
    t0 = time.time()
    print("[1/5] Downloading real ERCOT demand + weather data...")

    try:
        import requests
    except ImportError:
        print("ERROR: 'requests' package required for supabase mode.")
        print("Install with:  pip install requests")
        sys.exit(1)

    # ── Load Supabase credentials from .env ──
    import os
    env_path = Path(__file__).resolve().parent.parent / ".env"
    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").strip()
    supabase_key = os.environ.get("SUPABASE_ANON_KEY", "").strip()

    # Try reading from .env file
    env_vars: Dict[str, str] = {}
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if "=" not in line or line.startswith("#"):
                continue
            k, v = line.split("=", 1)
            env_vars[k.strip()] = v.strip()

    if not supabase_url:
        supabase_url = env_vars.get("NEXT_PUBLIC_SUPABASE_URL", "")
    if not supabase_key:
        # Use anon key for REST API
        supabase_key = env_vars.get("SUPABASE_ANON_KEY", "")

    if not supabase_url or not supabase_key:
        print("ERROR: Missing Supabase credentials.")
        print("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_ANON_KEY")
        print(f"in environment or in {env_path}")
        sys.exit(1)

    supabase_url = supabase_url.rstrip("/")

    # ── Fetch all ercot_load rows via REST (paginated, 1000 per page) ──
    print("  Fetching ERCOT demand from Supabase...")
    all_rows: List[Dict] = []
    page_size = 1000
    offset = 0

    while True:
        url = (
            f"{supabase_url}/rest/v1/ercot_load"
            f"?select=timestamp,ercot_total,coast,east,far_west,north,north_central,south,south_central,west"
            f"&order=timestamp.asc"
            f"&limit={page_size}&offset={offset}"
        )
        resp = requests.get(url, headers={
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
        }, timeout=60)
        if not resp.ok:
            print(f"ERROR: Supabase returned {resp.status_code}: {resp.text[:200]}")
            sys.exit(1)
        rows = resp.json()
        if not rows:
            break
        all_rows.extend(rows)
        offset += page_size
        if len(rows) < page_size:
            break

    if not all_rows:
        print("ERROR: No rows returned from ercot_load table.")
        sys.exit(1)

    print(f"    Fetched {len(all_rows):,} ERCOT demand rows")

    demand_df = pd.DataFrame(all_rows)
    demand_df["timestamp"] = pd.to_datetime(demand_df["timestamp"], utc=True)
    demand_df["ercot_total"] = pd.to_numeric(demand_df["ercot_total"], errors="coerce")
    demand_df = demand_df.sort_values("timestamp").reset_index(drop=True)

    start_date = demand_df["timestamp"].min().strftime("%Y-%m-%d")
    end_date = demand_df["timestamp"].max().strftime("%Y-%m-%d")
    print(f"    Date range: {start_date} to {end_date}")

    # ── Weather from Open-Meteo (real historical, free) ──
    print("  Downloading weather data from Open-Meteo...")
    all_weather: List[pd.DataFrame] = []

    for city_name, (lat, lon) in CITIES.items():
        url = (
            f"https://archive-api.open-meteo.com/v1/archive"
            f"?latitude={lat}&longitude={lon}"
            f"&start_date={start_date}&end_date={end_date}"
            f"&hourly=temperature_2m,wind_speed_10m"
            f"&temperature_unit=fahrenheit"
            f"&wind_speed_unit=mph"
            f"&timezone=UTC"
        )
        try:
            resp = requests.get(url, timeout=120)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            print(f"ERROR: Failed to download weather for {city_name}: {e}")
            sys.exit(1)

        hourly = data.get("hourly", {})
        if not hourly.get("time"):
            print(f"ERROR: No hourly data returned for {city_name}.")
            sys.exit(1)

        wdf = pd.DataFrame({
            "timestamp": pd.to_datetime(hourly["time"], utc=True),
            f"temp_{city_name.lower()}": hourly["temperature_2m"],
            f"wind_{city_name.lower()}": hourly["wind_speed_10m"],
        })
        all_weather.append(wdf)
        print(f"    {city_name}: {len(wdf):,} hours downloaded")

    # Merge city weather
    weather = all_weather[0]
    for wdf in all_weather[1:]:
        weather = weather.merge(wdf, on="timestamp", how="outer")

    # Average across cities
    temp_cols = [c for c in weather.columns if c.startswith("temp_")]
    wind_cols = [c for c in weather.columns if c.startswith("wind_")]
    weather["temperature_f"] = weather[temp_cols].mean(axis=1)
    weather["wind_speed_mph"] = weather[wind_cols].mean(axis=1)

    # ── Join demand + weather on timestamp ──
    print("  Joining demand + weather...")
    merged = demand_df.merge(weather[["timestamp", "temperature_f", "wind_speed_mph"]],
                              on="timestamp", how="inner")
    merged = merged.sort_values("timestamp").reset_index(drop=True)
    print(f"    Joined: {len(merged):,} rows")

    # ── Generate prices using rules engine with REAL demand + weather ──
    print("  Generating calibrated prices from real demand + weather...")

    h_of_day = merged["timestamp"].dt.hour
    tod = h_of_day.map(TOD_PREMIUM).fillna(1.0)

    temp = merged["temperature_f"].values
    wind = merged["wind_speed_mph"].values
    demand_mw = merged["ercot_total"].astype(float).values

    hdh = np.maximum(0.0, 65.0 - temp)
    cdh = np.maximum(0.0, temp - 75.0)
    temp_premium = hdh * 2.5 + cdh * 1.8
    wind_dep = np.maximum(0.3, 1.0 - wind * 0.015)

    price = (ERCOT_BASE_PRICE_MWH + temp_premium) * tod.values * wind_dep

    # Use REAL demand for grid utilization → scarcity pricing
    grid_util = np.minimum(1.0, demand_mw / ERCOT_CAPACITY_MW)
    scarcity = np.where(grid_util > 0.80, (grid_util - 0.80) ** 2 * 5000, 0.0)
    scarcity = scarcity + np.where(
        grid_util > 0.95, (grid_util - 0.95) * 20000, 0.0
    )
    price = price + scarcity

    # Stochastic noise calibrated to ERCOT volatility
    rng = np.random.default_rng(42)
    price = price * (1.0 + rng.normal(0, 0.08, len(price)))
    price = np.maximum(-15.0, price)

    df = pd.DataFrame({
        "timestamp": merged["timestamp"],
        "temperature_f": merged["temperature_f"].round(1),
        "wind_speed_mph": merged["wind_speed_mph"].round(1),
        "price_mwh": np.round(price, 2),
        "demand_mw": demand_mw.round(0),
    })
    df = df.dropna().reset_index(drop=True)

    elapsed = time.time() - t0
    print(f"    Dataset: {len(df):,} rows in {elapsed:.1f}s")
    print(f"    Temp range: {df['temperature_f'].min():.0f}°F to {df['temperature_f'].max():.0f}°F")
    print(f"    Price range: ${df['price_mwh'].min():.2f} to ${df['price_mwh'].max():.2f}/MWh")
    print(f"    Demand range: {df['demand_mw'].min():.0f} to {df['demand_mw'].max():.0f} MW")

    return df


# ══════════════════════════════════════════════════════════════════════
#  FEATURE ENGINEERING
# ══════════════════════════════════════════════════════════════════════


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """Compute all 16 training features from raw timestamp/temp/wind/price data."""
    t0 = time.time()
    print("[2/5] Engineering features...")

    df = df.copy()
    ts = pd.to_datetime(df["timestamp"])

    # ── Time features ──
    df["hour_of_day"] = ts.dt.hour
    df["day_of_week"] = ts.dt.dayofweek
    df["month"] = ts.dt.month
    df["is_weekend"] = (ts.dt.dayofweek >= 5).astype(int)

    # ── Degree-hours ──
    df["heating_degree_hours"] = np.maximum(0.0, 65.0 - df["temperature_f"])
    df["cooling_degree_hours"] = np.maximum(0.0, df["temperature_f"] - 75.0)

    # ── Demand estimate (MW) — use real demand if available ──
    if "demand_mw" in df.columns:
        df["demand_estimate_mw"] = df["demand_mw"].round(0)
    else:
        tod = df["hour_of_day"].map(TOD_PREMIUM).fillna(1.0)
        base_demand = ERCOT_CAPACITY_MW * 0.45
        heat_load = df["heating_degree_hours"] * 400
        cool_load = df["cooling_degree_hours"] * 350
        df["demand_estimate_mw"] = ((base_demand + heat_load + cool_load) * tod).round(0)

    # ── Renewable generation % ──
    wind_cf = np.minimum(1.0, df["wind_speed_mph"] / 25.0)
    df["renewable_gen_pct"] = (wind_cf * ERCOT_WIND_PENETRATION * 100).round(1)

    # ── Grid utilization % ──
    df["grid_utilization_pct"] = (
        (df["demand_estimate_mw"] / ERCOT_CAPACITY_MW) * 100
    ).clip(0, 100).round(1)

    # ── Rolling features (shifted by 1 to avoid leakage) ──
    df["rolling_24h_avg_price"] = (
        df["price_mwh"].shift(1).rolling(24, min_periods=1).mean()
    )
    df["rolling_24h_avg_temp"] = (
        df["temperature_f"].shift(1).rolling(24, min_periods=1).mean()
    )

    # ── Temperature change over 6 hours (cold front detector) ──
    df["temp_change_6h"] = df["temperature_f"] - df["temperature_f"].shift(6)

    # ── Extreme weather flags ──
    df["is_extreme_cold"] = (df["temperature_f"] < 20).astype(int)
    df["is_extreme_heat"] = (df["temperature_f"] > 100).astype(int)

    # Fill NaN from rolling/shift operations
    df = df.bfill().fillna(0)

    elapsed = time.time() - t0
    print(f"    {len(FEATURE_NAMES)} features computed in {elapsed:.1f}s")
    print(f"    Extreme cold hours: {df['is_extreme_cold'].sum()}")
    print(f"    Extreme heat hours: {df['is_extreme_heat'].sum()}")

    return df


# ══════════════════════════════════════════════════════════════════════
#  TRAINING & EVALUATION
# ══════════════════════════════════════════════════════════════════════


def train_and_evaluate(
    df: pd.DataFrame,
    data_source: str,
    output_dir: str,
) -> None:
    """Train XGBoost pipeline with TimeSeriesSplit CV, evaluate, save artifacts."""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    X = df[FEATURE_NAMES].values.astype(np.float32)
    y = df["price_mwh"].values.astype(np.float32)
    timestamps = pd.to_datetime(df["timestamp"])

    is_extreme = (df["is_extreme_cold"] == 1) | (df["is_extreme_heat"] == 1)
    extreme_mask = is_extreme.values

    # ── Build pipeline ──
    print("[3/5] Training XGBoost pipeline...")
    t0 = time.time()

    pipeline = Pipeline(
        [
            ("scaler", StandardScaler()),
            (
                "xgb",
                XGBRegressor(
                    n_estimators=500,
                    max_depth=6,
                    learning_rate=0.05,
                    subsample=0.8,
                    colsample_bytree=0.8,
                    objective="reg:squarederror",
                    random_state=42,
                    n_jobs=-1,
                ),
            ),
        ]
    )

    # ── 5-fold TimeSeriesSplit cross-validation ──
    print("    Running 5-fold TimeSeriesSplit cross-validation...")
    tscv = TimeSeriesSplit(n_splits=5)

    cv_r2: List[float] = []
    cv_mae: List[float] = []
    cv_rmse: List[float] = []

    for fold, (train_idx, val_idx) in enumerate(tscv.split(X), 1):
        X_tr, X_vl = X[train_idx], X[val_idx]
        y_tr, y_vl = y[train_idx], y[val_idx]

        pipeline.fit(X_tr, y_tr)
        y_pred = pipeline.predict(X_vl)

        r2 = r2_score(y_vl, y_pred)
        mae = mean_absolute_error(y_vl, y_pred)
        rmse = float(np.sqrt(mean_squared_error(y_vl, y_pred)))

        cv_r2.append(r2)
        cv_mae.append(mae)
        cv_rmse.append(rmse)
        print(f"      Fold {fold}: R²={r2:.4f}  MAE=${mae:.2f}  RMSE=${rmse:.2f}")

    avg_r2 = float(np.mean(cv_r2))
    avg_mae = float(np.mean(cv_mae))
    avg_rmse = float(np.mean(cv_rmse))
    print(f"    CV average:  R²={avg_r2:.4f}  MAE=${avg_mae:.2f}  RMSE=${avg_rmse:.2f}")

    # ── Final model on full dataset ──
    print("    Training final model on full dataset...")
    pipeline.fit(X, y)
    train_elapsed = time.time() - t0
    print(f"    Training complete in {train_elapsed:.1f}s")

    # ── Evaluation ──
    print("[4/5] Evaluating model...")
    t0 = time.time()

    y_pred_all = pipeline.predict(X)

    full_r2 = r2_score(y, y_pred_all)
    full_mae = mean_absolute_error(y, y_pred_all)
    full_rmse = float(np.sqrt(mean_squared_error(y, y_pred_all)))

    normal_mask = ~extreme_mask
    if normal_mask.sum() > 0:
        normal_r2 = r2_score(y[normal_mask], y_pred_all[normal_mask])
        normal_mae = mean_absolute_error(y[normal_mask], y_pred_all[normal_mask])
        normal_rmse = float(
            np.sqrt(mean_squared_error(y[normal_mask], y_pred_all[normal_mask]))
        )
    else:
        normal_r2 = normal_mae = normal_rmse = 0.0

    if extreme_mask.sum() > 0:
        extreme_r2 = r2_score(y[extreme_mask], y_pred_all[extreme_mask])
        extreme_mae = mean_absolute_error(y[extreme_mask], y_pred_all[extreme_mask])
        extreme_rmse = float(
            np.sqrt(mean_squared_error(y[extreme_mask], y_pred_all[extreme_mask]))
        )
    else:
        extreme_r2 = extreme_mae = extreme_rmse = 0.0

    eval_elapsed = time.time() - t0
    print(f"    Full dataset:    R²={full_r2:.4f}  MAE=${full_mae:.2f}  RMSE=${full_rmse:.2f}")
    print(f"    Normal periods:  R²={normal_r2:.4f}  MAE=${normal_mae:.2f}  RMSE=${normal_rmse:.2f}")
    print(f"    Extreme periods: R²={extreme_r2:.4f}  MAE=${extreme_mae:.2f}  RMSE=${extreme_rmse:.2f}")

    # ── Feature importance ──
    xgb_model = pipeline.named_steps["xgb"]
    importances = xgb_model.feature_importances_
    importance_dict = {
        name: round(float(imp), 6)
        for name, imp in sorted(
            zip(FEATURE_NAMES, importances), key=lambda x: x[1], reverse=True
        )
    }

    # ── Save artifacts ──
    print("[5/5] Saving artifacts...")
    t0 = time.time()

    # 1. Model pickle
    model_path = output_path / "price_model.pkl"
    with open(model_path, "wb") as f:
        pickle.dump(pipeline, f)
    print(f"    {model_path} ({model_path.stat().st_size / 1024:.0f} KB)")

    # 2. Metadata JSON
    date_range = (
        f"{timestamps.min().strftime('%Y-%m-%d')} to "
        f"{timestamps.max().strftime('%Y-%m-%d')}"
    )
    metadata = {
        "training_date": datetime.now(timezone.utc).isoformat(),
        "n_samples": int(len(X)),
        "n_features": len(FEATURE_NAMES),
        "feature_names": FEATURE_NAMES,
        "cv_r2_score": round(avg_r2, 6),
        "cv_mae": round(avg_mae, 2),
        "cv_rmse": round(avg_rmse, 2),
        "full_r2_score": round(full_r2, 6),
        "data_source": (
            "supabase_ercot" if data_source == "supabase"
            else "ercot_historical" if data_source == "ercot"
            else "synthetic"
        ),
        "date_range": date_range,
        "normal_r2": round(normal_r2, 6),
        "normal_mae": round(normal_mae, 2),
        "extreme_r2": round(extreme_r2, 6),
        "extreme_mae": round(extreme_mae, 2),
    }
    meta_path = output_path / "price_model_metadata.json"
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"    {meta_path}")

    # 3. Feature importance JSON
    imp_path = output_path / "feature_importance.json"
    with open(imp_path, "w") as f:
        json.dump(importance_dict, f, indent=2)
    print(f"    {imp_path}")

    # 4. Training report
    report_lines = [
        "=" * 62,
        "  BLACKOUT — XGBoost Price Model Training Report",
        "=" * 62,
        "",
        f"  Date:           {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        f"  Data source:    {metadata['data_source']}",
        f"  Date range:     {date_range}",
        f"  Samples:        {len(X):,}",
        f"  Features:       {len(FEATURE_NAMES)}",
        "",
        "  -- Cross-Validation (5-fold TimeSeries) --",
        f"     R²:   {avg_r2:.4f}",
        f"     MAE:  ${avg_mae:.2f}/MWh",
        f"     RMSE: ${avg_rmse:.2f}/MWh",
        "",
        "  -- Full Dataset --",
        f"     R²:   {full_r2:.4f}",
        f"     MAE:  ${full_mae:.2f}/MWh",
        f"     RMSE: ${full_rmse:.2f}/MWh",
        "",
        "  -- Normal Periods --",
        f"     R²:   {normal_r2:.4f}",
        f"     MAE:  ${normal_mae:.2f}/MWh",
        f"     RMSE: ${normal_rmse:.2f}/MWh",
        "",
        "  -- Extreme Periods (cold < 20°F or heat > 100°F) --",
        f"     R²:   {extreme_r2:.4f}",
        f"     MAE:  ${extreme_mae:.2f}/MWh",
        f"     RMSE: ${extreme_rmse:.2f}/MWh",
        "",
        "  -- Feature Importance (top 10) --",
    ]
    for i, (feat, imp) in enumerate(importance_dict.items()):
        if i >= 10:
            break
        report_lines.append(f"     {i + 1:2d}. {feat:30s} {imp:.4f}")
    report_lines.extend(["", "=" * 62])
    report_text = "\n".join(report_lines)

    report_path = output_path / "training_report.txt"
    with open(report_path, "w") as f:
        f.write(report_text)
    print(f"    {report_path}")

    # 5. Evaluation chart
    _save_eval_chart(
        timestamps, y, y_pred_all, extreme_mask, output_path / "price_model_eval.png"
    )

    save_elapsed = time.time() - t0

    # ── Print report to stdout ──
    print()
    print(report_text)
    print()
    print(f"  All artifacts saved to: {output_path.resolve()}")


def _save_eval_chart(
    timestamps: pd.Series,
    y_actual: np.ndarray,
    y_pred: np.ndarray,
    extreme_mask: np.ndarray,
    path: Path,
) -> None:
    """Actual vs predicted chart with extreme spike highlighting."""
    fig, axes = plt.subplots(
        2, 1, figsize=(14, 8), gridspec_kw={"height_ratios": [3, 1]}
    )
    fig.patch.set_facecolor("#0a0a0a")

    # ── Top: actual vs predicted ──
    ax1 = axes[0]
    ax1.set_facecolor("#111111")
    ax1.plot(
        timestamps, y_actual,
        color="#555555", linewidth=0.3, alpha=0.7, label="Actual",
    )
    ax1.plot(
        timestamps, y_pred,
        color="#22c55e", linewidth=0.3, alpha=0.7, label="Predicted",
    )

    extreme_ts = timestamps[extreme_mask]
    ax1.scatter(
        extreme_ts, y_actual[extreme_mask],
        color="#ef4444", s=4, zorder=5, label="Extreme (actual)",
    )
    ax1.scatter(
        extreme_ts, y_pred[extreme_mask],
        color="#f59e0b", s=4, zorder=5, label="Extreme (predicted)",
    )

    ax1.set_ylabel("Price ($/MWh)", color="#a1a1aa")
    ax1.set_title(
        "XGBoost Price Model — Actual vs Predicted",
        color="#e4e4e7", fontsize=13,
    )
    ax1.legend(loc="upper right", fontsize=8, facecolor="#1a1a1a", edgecolor="#333")
    ax1.tick_params(colors="#a1a1aa")
    ax1.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
    ax1.set_xlim(timestamps.min(), timestamps.max())

    # ── Bottom: residuals ──
    ax2 = axes[1]
    ax2.set_facecolor("#111111")
    residuals = y_actual - y_pred
    ax2.bar(
        timestamps, residuals,
        width=0.04, color="#555555", alpha=0.5,
    )
    ax2.axhline(0, color="#22c55e", linewidth=0.8)
    ax2.set_ylabel("Residual ($/MWh)", color="#a1a1aa")
    ax2.set_xlabel("Date", color="#a1a1aa")
    ax2.tick_params(colors="#a1a1aa")
    ax2.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
    ax2.set_xlim(timestamps.min(), timestamps.max())

    for spine in [*ax1.spines.values(), *ax2.spines.values()]:
        spine.set_color("#333333")

    plt.tight_layout()
    fig.savefig(path, dpi=150, bbox_inches="tight", facecolor="#0a0a0a")
    plt.close(fig)
    print(f"    {path}")


# ══════════════════════════════════════════════════════════════════════
#  CLI
# ══════════════════════════════════════════════════════════════════════


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train XGBoost price model for the Blackout API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "examples:\n"
            "  python scripts/train_price_model.py --data-source synthetic\n"
            "  python scripts/train_price_model.py --data-source ercot --years 2\n"
            "  python scripts/train_price_model.py --data-source supabase\n"
            "  python scripts/train_price_model.py --output-dir backend/models\n"
        ),
    )
    parser.add_argument(
        "--data-source",
        choices=["synthetic", "ercot", "supabase"],
        default="synthetic",
        help="'synthetic' (fast), 'ercot' (real weather), or 'supabase' (real ERCOT demand + weather)",
    )
    parser.add_argument(
        "--output-dir",
        default="models",
        help="Directory for output artifacts (default: models/)",
    )
    parser.add_argument(
        "--years",
        type=int,
        default=2,
        help="Years of data for ERCOT mode (default: 2, covers 2020-2021)",
    )
    args = parser.parse_args()

    total_start = time.time()
    print()
    print("  ┌──────────────────────────────────────────────────────┐")
    print("  │   Blackout — XGBoost Price Model Training            │")
    print("  └──────────────────────────────────────────────────────┘")
    print(f"  Data source:  {args.data_source}")
    print(f"  Output dir:   {args.output_dir}")
    if args.data_source == "ercot":
        print(f"  Years:        {args.years}")
    print()

    # Step 1: Raw data
    if args.data_source == "synthetic":
        df = generate_synthetic_data()
    elif args.data_source == "supabase":
        df = download_supabase_data()
    else:
        df = download_ercot_data(years=args.years)

    # Step 2: Feature engineering
    df = engineer_features(df)

    # Steps 3-5: Train, evaluate, save
    train_and_evaluate(df, args.data_source, args.output_dir)

    total_elapsed = time.time() - total_start
    print(f"\n  Total time: {total_elapsed:.1f}s")


if __name__ == "__main__":
    main()
