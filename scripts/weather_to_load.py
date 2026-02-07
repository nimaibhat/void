#!/usr/bin/env python3
"""ML-Enhanced Weather → Electric Load Predictor

Fetches historical weather + ERCOT demand data, trains a RandomForestRegressor,
and produces 48-hour load forecasts with both physics-based and ML predictions.

Usage:
    python weather_to_load.py                  # full pipeline: download → train → forecast
    python weather_to_load.py --train-only     # download data + train model only
    python weather_to_load.py --forecast-only  # forecast using saved model (skip training)
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import requests
from dotenv import load_dotenv
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split

# ── Configuration ──────────────────────────────────────────────────────

ERCOT_BASE_LOAD_MW = 50_000
HDD_COEFFICIENT = 0.02
CDD_COEFFICIENT = 0.015
BALANCE_POINT_F = 65
PEAK_MULTIPLIER = 1.2
PEAK_START_HOUR = 16
PEAK_END_HOUR = 20

LATITUDE = 30.27
LONGITUDE = -97.74
TIMEZONE = "America/Chicago"

# Paths (relative to project root)
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
MODELS_DIR = PROJECT_ROOT / "models"
OUTPUT_FILE = PROJECT_ROOT / "load_forecast.csv"
WEATHER_CACHE = DATA_DIR / "historical_weather.csv"
DEMAND_CACHE = DATA_DIR / "historical_demand.csv"
MODEL_PATH = MODELS_DIR / "load_model.pkl"
MODEL_META_PATH = MODELS_DIR / "load_model_metadata.json"

HIST_START_YEAR = 2019
HIST_END_YEAR = 2024

# Load .env for EIA API key
load_dotenv(PROJECT_ROOT / ".env")
EIA_API_KEY = os.getenv("EIA_API_KEY", "")

# ── Historical Weather (Open-Meteo Archive) ────────────────────────────


def fetch_historical_weather(start_year: int = HIST_START_YEAR,
                             end_year: int = HIST_END_YEAR) -> pd.DataFrame:
    """Fetch historical hourly weather from Open-Meteo archive API, year-by-year."""
    if WEATHER_CACHE.exists():
        print(f"  Loading cached weather data from {WEATHER_CACHE}")
        df = pd.read_csv(WEATHER_CACHE, parse_dates=["timestamp"])
        print(f"  Loaded {len(df):,} rows")
        return df

    url = "https://archive-api.open-meteo.com/v1/archive"
    frames = []

    for year in range(start_year, end_year + 1):
        start_date = f"{year}-01-01"
        end_date = f"{year}-12-31"
        params = {
            "latitude": LATITUDE,
            "longitude": LONGITUDE,
            "start_date": start_date,
            "end_date": end_date,
            "hourly": "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m",
            "temperature_unit": "fahrenheit",
            "wind_speed_unit": "mph",
            "timezone": TIMEZONE,
        }

        print(f"  Fetching weather for {year} ...")
        resp = requests.get(url, params=params, timeout=60)
        resp.raise_for_status()
        data = resp.json()["hourly"]

        ydf = pd.DataFrame({
            "timestamp": pd.to_datetime(data["time"]),
            "temperature_f": data["temperature_2m"],
            "feels_like_f": data["apparent_temperature"],
            "humidity_pct": data["relative_humidity_2m"],
            "wind_speed_mph": data["wind_speed_10m"],
        })
        frames.append(ydf)
        print(f"    → {len(ydf):,} rows")
        time.sleep(0.5)  # polite rate limiting

    df = pd.concat(frames, ignore_index=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(WEATHER_CACHE, index=False)
    print(f"  Cached {len(df):,} rows to {WEATHER_CACHE}")
    return df


# ── Historical ERCOT Demand (EIA API v2) ───────────────────────────────


def fetch_historical_demand(start_year: int = HIST_START_YEAR,
                            end_year: int = HIST_END_YEAR) -> pd.DataFrame:
    """Fetch historical hourly ERCOT demand from EIA API v2, year-by-year with pagination."""
    if DEMAND_CACHE.exists():
        print(f"  Loading cached demand data from {DEMAND_CACHE}")
        df = pd.read_csv(DEMAND_CACHE, parse_dates=["timestamp"])
        print(f"  Loaded {len(df):,} rows")
        return df

    if not EIA_API_KEY:
        print("ERROR: EIA_API_KEY not found in .env file")
        sys.exit(1)

    url = "https://api.eia.gov/v2/electricity/rto/region-data/data/"
    frames = []

    for year in range(start_year, end_year + 1):
        start_date = f"{year}-01-01T00"
        end_date = f"{year}-12-31T23"
        offset = 0
        year_rows = []

        while True:
            params = {
                "api_key": EIA_API_KEY,
                "frequency": "hourly",
                "data[0]": "value",
                "facets[respondent][]": "TEX",
                "facets[type][]": "D",
                "start": start_date,
                "end": end_date,
                "sort[0][column]": "period",
                "sort[0][direction]": "asc",
                "offset": offset,
                "length": 5000,
            }

            print(f"  Fetching ERCOT demand for {year} (offset={offset}) ...")
            resp = requests.get(url, params=params, timeout=60)
            resp.raise_for_status()
            body = resp.json()
            records = body.get("response", {}).get("data", [])

            if not records:
                break

            for rec in records:
                period_str = rec.get("period", "")
                value = rec.get("value")
                if value is not None:
                    year_rows.append({
                        "timestamp": period_str,
                        "demand_mw": float(value),
                    })

            print(f"    → got {len(records)} records")
            if len(records) < 5000:
                break
            offset += 5000
            time.sleep(0.3)

        frames.extend(year_rows)
        print(f"    {year} total: {len(year_rows):,} rows")

    df = pd.DataFrame(frames)
    # Parse the EIA period format (e.g. "2019-01-01T05")
    df["timestamp"] = pd.to_datetime(df["timestamp"], format="mixed")
    # Localize to Central Time to match weather data
    df = df.sort_values("timestamp").reset_index(drop=True)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(DEMAND_CACHE, index=False)
    print(f"  Cached {len(df):,} rows to {DEMAND_CACHE}")
    return df


# ── Feature Engineering ────────────────────────────────────────────────

FEATURE_COLS = [
    "temperature_f", "feels_like_f", "HDD", "CDD",
    "wind_speed_mph", "humidity_pct",
    "hour", "day_of_week", "month", "is_weekend",
]


def engineer_features(weather_df: pd.DataFrame,
                      demand_df: pd.DataFrame) -> pd.DataFrame:
    """Merge weather + demand and compute features for ML training."""
    # Normalize timestamps to hour precision for joining
    weather_df = weather_df.copy()
    demand_df = demand_df.copy()
    weather_df["timestamp"] = pd.to_datetime(weather_df["timestamp"]).dt.floor("h")
    demand_df["timestamp"] = pd.to_datetime(demand_df["timestamp"]).dt.floor("h")

    # Merge on timestamp
    df = pd.merge(weather_df, demand_df, on="timestamp", how="inner")
    print(f"  Merged dataset: {len(df):,} rows")

    # Degree-days
    df["HDD"] = (BALANCE_POINT_F - df["temperature_f"]).clip(lower=0)
    df["CDD"] = (df["temperature_f"] - BALANCE_POINT_F).clip(lower=0)

    # Time features
    df["hour"] = df["timestamp"].dt.hour
    df["day_of_week"] = df["timestamp"].dt.dayofweek
    df["month"] = df["timestamp"].dt.month
    df["is_weekend"] = (df["day_of_week"] >= 5).astype(int)

    # Drop rows with NaN in features or target
    df = df.dropna(subset=FEATURE_COLS + ["demand_mw"])
    print(f"  After cleaning: {len(df):,} rows")

    return df


# ── ML Training ────────────────────────────────────────────────────────


def train_load_model(df: pd.DataFrame) -> RandomForestRegressor:
    """Train a RandomForestRegressor on the engineered features."""
    X = df[FEATURE_COLS].values
    y = df["demand_mw"].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    print(f"  Training set: {len(X_train):,}  |  Test set: {len(X_test):,}")
    print("  Training RandomForestRegressor (n_estimators=100, max_depth=20) ...")

    model = RandomForestRegressor(
        n_estimators=100,
        max_depth=20,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    train_r2 = model.score(X_train, y_train)
    test_r2 = model.score(X_test, y_test)

    y_pred = model.predict(X_test)
    mae = np.mean(np.abs(y_test - y_pred))
    rmse = np.sqrt(np.mean((y_test - y_pred) ** 2))

    print(f"\n  ── Model Performance ──")
    print(f"  Train R²:  {train_r2:.4f}")
    print(f"  Test  R²:  {test_r2:.4f}")
    print(f"  MAE:       {mae:,.0f} MW")
    print(f"  RMSE:      {rmse:,.0f} MW")

    # Feature importance
    importances = dict(zip(FEATURE_COLS, model.feature_importances_))
    sorted_imp = sorted(importances.items(), key=lambda x: x[1], reverse=True)
    print(f"\n  ── Feature Importance ──")
    for feat, imp in sorted_imp:
        bar = "█" * int(imp * 50)
        print(f"  {feat:<18s} {imp:.4f}  {bar}")

    # Save model
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    print(f"\n  Model saved to {MODEL_PATH}")

    # Save metadata
    metadata = {
        "trained_at": datetime.now().isoformat(),
        "train_r2": round(train_r2, 4),
        "test_r2": round(test_r2, 4),
        "mae_mw": round(mae, 1),
        "rmse_mw": round(rmse, 1),
        "n_train": len(X_train),
        "n_test": len(X_test),
        "features": FEATURE_COLS,
        "feature_importance": {k: round(v, 4) for k, v in sorted_imp},
        "date_range": f"{HIST_START_YEAR}-01-01 to {HIST_END_YEAR}-12-31",
    }
    with open(MODEL_META_PATH, "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"  Metadata saved to {MODEL_META_PATH}")

    return model


# ── Physics-based prediction (original method) ────────────────────────


def predict_physics(df: pd.DataFrame) -> pd.Series:
    """Apply the original degree-day method for physics-based load prediction."""
    load_multiplier = 1 + (df["HDD"] * HDD_COEFFICIENT) + (df["CDD"] * CDD_COEFFICIENT)
    load = ERCOT_BASE_LOAD_MW * load_multiplier

    is_peak = df["hour"].between(PEAK_START_HOUR, PEAK_END_HOUR)
    load = load.copy()
    load.loc[is_peak] *= PEAK_MULTIPLIER

    return load.round(0).astype(int)


# ── Forecast Pipeline ──────────────────────────────────────────────────


def fetch_forecast_weather() -> pd.DataFrame:
    """Fetch 48-hour weather forecast from Open-Meteo, including feels-like and humidity."""
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": LATITUDE,
        "longitude": LONGITUDE,
        "hourly": "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m",
        "temperature_unit": "fahrenheit",
        "wind_speed_unit": "mph",
        "forecast_days": 2,
        "timezone": TIMEZONE,
    }

    resp = requests.get(url, params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()["hourly"]

    df = pd.DataFrame({
        "timestamp": pd.to_datetime(data["time"]),
        "temperature_f": data["temperature_2m"],
        "feels_like_f": data["apparent_temperature"],
        "humidity_pct": data["relative_humidity_2m"],
        "wind_speed_mph": data["wind_speed_10m"],
    })
    return df


def run_forecast(model: RandomForestRegressor | None = None) -> pd.DataFrame:
    """Produce 48-hour forecast with physics and ML predictions."""
    print("Fetching 48-hour weather forecast ...")
    df = fetch_forecast_weather()

    # Degree-days
    df["HDD"] = (BALANCE_POINT_F - df["temperature_f"]).clip(lower=0)
    df["CDD"] = (df["temperature_f"] - BALANCE_POINT_F).clip(lower=0)

    # Time features
    df["hour"] = df["timestamp"].dt.hour
    df["day_of_week"] = df["timestamp"].dt.dayofweek
    df["month"] = df["timestamp"].dt.month
    df["is_weekend"] = (df["day_of_week"] >= 5).astype(int)

    # Physics prediction
    df["predicted_load_physics_mw"] = predict_physics(df)

    # ML prediction
    if model is not None:
        X = df[FEATURE_COLS].values
        df["predicted_load_ml_mw"] = model.predict(X).round(0).astype(int)
    else:
        df["predicted_load_ml_mw"] = None

    # Peak hour flag
    df["is_peak_hour"] = df["hour"].between(PEAK_START_HOUR, PEAK_END_HOUR)

    # Format for output
    out = df[[
        "timestamp", "temperature_f", "HDD", "CDD",
        "predicted_load_physics_mw", "predicted_load_ml_mw", "is_peak_hour",
    ]].copy()
    out["timestamp"] = out["timestamp"].dt.strftime("%Y-%m-%d %H:%M")

    return out


def print_summary(df: pd.DataFrame) -> None:
    """Print a human-readable summary of the forecast."""
    temp = df["temperature_f"]
    physics = df["predicted_load_physics_mw"]
    has_ml = df["predicted_load_ml_mw"].notna().any()

    print("\n" + "=" * 65)
    print("  ERCOT Load Forecast Summary (48-hour)")
    print("=" * 65)
    print(f"  Period:       {df['timestamp'].iloc[0]}  →  {df['timestamp'].iloc[-1]}")
    print(f"  Location:     Austin, TX ({LATITUDE}, {LONGITUDE})")
    print()
    print(f"  Temperature:  {temp.min():.1f}°F min  /  {temp.max():.1f}°F max  /  {temp.mean():.1f}°F avg")
    print()
    print(f"  Physics Load: {physics.min():,} MW min  /  {physics.max():,} MW max  /  {physics.mean():,.0f} MW avg")

    if has_ml:
        ml = df["predicted_load_ml_mw"].astype(int)
        print(f"  ML Load:      {ml.min():,} MW min  /  {ml.max():,} MW max  /  {ml.mean():,.0f} MW avg")

    # Blackout risk (use ML if available, else physics)
    check = df["predicted_load_ml_mw"].astype(float) if has_ml else physics.astype(float)
    max_load = check.max()
    if max_load >= 80_000:
        print()
        if max_load >= 100_000:
            print("  *** EXTREME BLACKOUT RISK ***")
            print(f"  Predicted peak of {max_load:,.0f} MW exceeds ERCOT capacity!")
        else:
            print("  ** HIGH LOAD WARNING **")
            print(f"  Predicted peak of {max_load:,.0f} MW is approaching grid limits.")

    print("=" * 65 + "\n")


# ── CLI ────────────────────────────────────────────────────────────────


def cmd_train() -> RandomForestRegressor:
    """Download historical data and train the model."""
    print("\n── Step 1: Fetch Historical Weather ──")
    weather_df = fetch_historical_weather()

    print("\n── Step 2: Fetch Historical ERCOT Demand ──")
    demand_df = fetch_historical_demand()

    print("\n── Step 3: Feature Engineering ──")
    merged_df = engineer_features(weather_df, demand_df)

    # Quick validation: Winter Storm Uri
    uri = merged_df[
        (merged_df["timestamp"] >= "2021-02-14") &
        (merged_df["timestamp"] <= "2021-02-18")
    ]
    if not uri.empty:
        print(f"\n  ── Winter Storm Uri Validation ──")
        print(f"  Rows:    {len(uri)}")
        print(f"  Temp:    {uri['temperature_f'].min():.1f}°F min  /  {uri['temperature_f'].max():.1f}°F max")
        print(f"  Demand:  {uri['demand_mw'].min():,.0f} MW min  /  {uri['demand_mw'].max():,.0f} MW max")

    print("\n── Step 4: Train Model ──")
    model = train_load_model(merged_df)
    return model


def cmd_forecast(model: RandomForestRegressor | None = None) -> None:
    """Load saved model (if not provided) and run forecast."""
    if model is None and MODEL_PATH.exists():
        print(f"Loading saved model from {MODEL_PATH} ...")
        model = joblib.load(MODEL_PATH)
    elif model is None:
        print("WARNING: No trained model found. ML predictions will be empty.")
        print("         Run with --train-only first to train the model.\n")

    df = run_forecast(model)
    df.to_csv(OUTPUT_FILE, index=False)
    print(f"Saved forecast to {OUTPUT_FILE}")
    print_summary(df)


def main():
    parser = argparse.ArgumentParser(
        description="ML-Enhanced Weather → Load Predictor for ERCOT"
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--train-only", action="store_true",
                       help="Download data and train model (no forecast)")
    group.add_argument("--forecast-only", action="store_true",
                       help="Run forecast using saved model (no training)")
    args = parser.parse_args()

    if args.train_only:
        cmd_train()
    elif args.forecast_only:
        cmd_forecast()
    else:
        # Full pipeline
        model = cmd_train()
        print("\n── Step 5: 48-Hour Forecast ──")
        cmd_forecast(model)


if __name__ == "__main__":
    main()
