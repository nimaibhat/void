"""Price Prediction Service — XGBoost ML, deterministic rules, and hybrid modes.

Generates 48-hour wholesale and retail electricity price forecasts per ISO
region, driven by weather conditions, demand patterns, wind generation, and
grid stress.

ML mode requires a pre-trained model at models/price_model.pkl (produced by
scripts/train_price_model.py).  When the file is absent the service falls back
to the deterministic rules engine automatically.
"""

from __future__ import annotations

import json as _json
import logging
import math
import pickle
import time as _time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import requests

from app.models.price import HourlyPrice, PricingMode
from app.services.demand_service import TOD_CURVE

logger = logging.getLogger(__name__)

# ── Base wholesale prices by region ($/MWh, normal conditions) ────────

BASE_PRICE_MWH: Dict[str, float] = {
    "ERCOT": 28.0,
    "CAISO": 45.0,
    "PJM": 35.0,
    "MISO": 30.0,
    "NYISO": 42.0,
    "ISO-NE": 40.0,
    "SPP": 25.0,
}

# ── Time-of-day price premium curve ──────────────────────────────────

TOD_PRICE_PREMIUM: Dict[int, float] = {
    0: 0.70, 1: 0.65, 2: 0.60, 3: 0.58, 4: 0.58, 5: 0.62,
    6: 0.75, 7: 0.90, 8: 1.00, 9: 1.05, 10: 1.08, 11: 1.10,
    12: 1.12, 13: 1.15, 14: 1.18, 15: 1.20, 16: 1.25, 17: 1.35,
    18: 1.40, 19: 1.35, 20: 1.20, 21: 1.05, 22: 0.90, 23: 0.80,
}

# ── Typical wind capacity factor by hour (winter pattern) ────────────

WIND_HOURLY_FACTOR: Dict[int, float] = {
    0: 0.42, 1: 0.44, 2: 0.45, 3: 0.46, 4: 0.45, 5: 0.43,
    6: 0.40, 7: 0.35, 8: 0.30, 9: 0.28, 10: 0.25, 11: 0.23,
    12: 0.22, 13: 0.24, 14: 0.26, 15: 0.28, 16: 0.30, 17: 0.32,
    18: 0.34, 19: 0.36, 20: 0.38, 21: 0.40, 22: 0.41, 23: 0.42,
}

# ── Region-specific wind penetration ─────────────────────────────────

WIND_PENETRATION: Dict[str, float] = {
    "ERCOT": 0.25,
    "SPP": 0.35,
    "CAISO": 0.10,
    "MISO": 0.15,
    "PJM": 0.05,
    "NYISO": 0.05,
    "ISO-NE": 0.04,
}

# ── Normal wind speed by hour (mph, for ML features) ─────────────────

NORMAL_WIND_MPH: Dict[int, float] = {
    0: 12, 1: 13, 2: 13, 3: 14, 4: 14, 5: 13,
    6: 12, 7: 10, 8: 9, 9: 8, 10: 7, 11: 7,
    12: 7, 13: 7, 14: 8, 15: 8, 16: 9, 17: 10,
    18: 10, 19: 11, 20: 11, 21: 12, 22: 12, 23: 12,
}

# ── ERCOT grid capacity (MW) ─────────────────────────────────────────

ERCOT_CAPACITY_MW = 85_000

# ── Zone-level structural price multipliers ──────────────────────────
# Reflects transmission congestion, local generation mix, and demand density.
# ~25% spread between cheapest (Far West wind-rich) and most expensive (North Central demand-heavy).

ZONE_PRICE_FACTORS: Dict[str, float] = {
    "Far West": 0.85,
    "West": 0.90,
    "Coast": 0.92,
    "Southern": 0.95,
    "East": 0.97,
    "North": 1.00,
    "South Central": 1.05,
    "North Central": 1.08,
}

# ── Zone lat/lon for weather lookups ─────────────────────────────────

ZONE_COORDS: Dict[str, Tuple[float, float]] = {
    "Coast": (29.76, -95.37),
    "East": (31.33, -94.73),
    "Far West": (31.99, -102.08),
    "North": (33.20, -97.13),
    "North Central": (32.78, -96.80),
    "South Central": (30.27, -97.74),
    "Southern": (27.80, -97.40),
    "West": (31.44, -100.45),
}

# ── Simple in-memory weather cache (zone → (timestamp, data)) ────────

_weather_cache: Dict[str, Tuple[float, List[Dict[str, float]]]] = {}
_WEATHER_CACHE_TTL = 900  # 15 minutes

# ── URI scenario profiles (48 hours) ─────────────────────────────────

URI_TEMP_PROFILE: List[float] = [
    # Feb 14 (h0-h23)
    20, 18, 16, 14, 12, 10, 9, 8, 10, 13, 16, 18,
    19, 18, 16, 14, 12, 10, 8, 7, 6, 5, 5, 4,
    # Feb 15 (h24-h47)
    3, 2, 1, 0, -1, -2, -1, 0, 2, 5, 8, 10,
    12, 11, 9, 7, 5, 3, 1, 0, -1, -2, -3, -2,
]

URI_WIND_FACTOR: List[float] = [
    0.30, 0.28, 0.25, 0.20, 0.18, 0.15, 0.12, 0.10,
    0.08, 0.06, 0.05, 0.04, 0.03, 0.03, 0.02, 0.02,
    0.02, 0.02, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01,
    0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01,
    0.01, 0.01, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02,
    0.02, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01,
]

URI_WIND_MPH: List[float] = [
    8, 7, 7, 6, 5, 5, 4, 4, 3, 3, 2, 2,
    2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2,
    2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1,
]

# ── ML feature names (must match scripts/train_price_model.py) ───────

ML_FEATURE_NAMES: List[str] = [
    "temperature_f", "wind_speed_mph", "hour_of_day", "day_of_week",
    "month", "is_weekend", "heating_degree_hours", "cooling_degree_hours",
    "demand_estimate_mw", "renewable_gen_pct", "grid_utilization_pct",
    "rolling_24h_avg_price", "rolling_24h_avg_temp", "temp_change_6h",
    "is_extreme_cold", "is_extreme_heat",
]


# ── Helpers ───────────────────────────────────────────────────────────


def _estimate_grid_util(hdh: float, cdh: float, hour: int) -> float:
    """Estimate grid utilization fraction from degree-hours and TOD."""
    tod = TOD_CURVE.get(hour % 24, 1.0)
    stress = (hdh * 0.008 + cdh * 0.006) * tod
    return min(1.0, 0.45 + stress)


def _rules_price_raw(
    hour: int,
    temp_f: float,
    wind_factor: float,
    grid_util: float,
    base_price: float,
    is_uri: bool,
) -> float:
    """Pure rules-based price calculation."""
    hdh = max(0.0, 65.0 - temp_f)
    cdh = max(0.0, temp_f - 75.0)
    tod = TOD_PRICE_PREMIUM.get(hour % 24, 1.0)

    temp_premium = hdh * 2.5 + cdh * 1.8
    wind_depression = max(0.3, 1.0 - wind_factor * 0.4)

    scarcity = 0.0
    if grid_util > 0.80:
        scarcity = (grid_util - 0.80) ** 2 * 5000
    if grid_util > 0.95:
        scarcity += (grid_util - 0.95) * 20000

    if is_uri and hdh > 40:
        uri_spike = min(9000.0, hdh * 80 + scarcity * 3)
        scarcity = max(scarcity, uri_spike)

    price = (base_price + temp_premium) * tod * wind_depression + scarcity
    return round(max(-15.0, price), 2)


def _hybrid_blend(
    ml_price: float,
    rules_price: float,
    hour: int,
    wind_factor: float,
    is_uri: bool,
) -> float:
    """Hybrid mode: 70% ML + 30% rules, with guardrails."""
    price = ml_price * 0.7 + rules_price * 0.3

    if 2 <= hour <= 5 and wind_factor > 0.15:
        price = min(price, -5.0 * wind_factor)

    if is_uri and rules_price > 500:
        price = max(price, rules_price * 0.85)

    return round(max(-20.0, price), 2)


# ── PriceService ──────────────────────────────────────────────────────


class PriceService:
    """Electricity price prediction with optional ML, rules, and hybrid modes."""

    def __init__(self) -> None:
        self.model: Any = None
        self.feature_names: List[str] = list(ML_FEATURE_NAMES)
        self.training_date: Optional[datetime] = None
        self.training_score: Optional[float] = None
        self.training_samples: Optional[int] = None

    # ── Startup: load pre-trained model from disk ─────────────────

    async def load_model(self) -> None:
        """Try to load pre-trained sklearn Pipeline from models/price_model.pkl.

        If the file doesn't exist or can't be loaded, the service silently
        falls back to rules mode.  No error is raised.
        """
        candidates = [
            Path("models/price_model.pkl"),
            Path("../models/price_model.pkl"),
        ]
        model_path: Optional[Path] = None
        for p in candidates:
            if p.exists():
                model_path = p
                break

        if model_path is None:
            logger.info(
                "No pre-trained price model found (checked %s) — using rules mode",
                ", ".join(str(c) for c in candidates),
            )
            return

        try:
            with open(model_path, "rb") as f:
                self.model = pickle.load(f)

            # Load metadata if available
            meta_path = model_path.parent / "price_model_metadata.json"
            if meta_path.exists():
                with open(meta_path) as f:
                    meta = _json.load(f)
                self.training_date = datetime.fromisoformat(
                    meta.get("training_date", "")
                )
                self.training_score = meta.get("cv_r2_score")
                self.training_samples = meta.get("n_samples")
                self.feature_names = meta.get("feature_names", self.feature_names)

            logger.info(
                "Loaded pre-trained price model from %s (R²=%.4f, %s samples)",
                model_path,
                self.training_score or 0,
                f"{self.training_samples:,}" if self.training_samples else "?",
            )
        except Exception as e:
            logger.warning("Failed to load price model: %s — using rules mode", e)
            self.model = None

    # ── 16-feature vector builder (matches training script) ───────

    def _build_ml_features(
        self,
        hours: int,
        temps: np.ndarray,
        wind_mphs: np.ndarray,
        rules_prices: np.ndarray,
    ) -> np.ndarray:
        """Build feature matrix matching scripts/train_price_model.py exactly."""
        now = datetime.now(timezone.utc)
        features = np.zeros((hours, 16), dtype=np.float32)

        for h in range(hours):
            dt = now + timedelta(hours=h)
            hod = h % 24
            temp = float(temps[h])
            wind = float(wind_mphs[h])

            hdh = max(0.0, 65.0 - temp)
            cdh = max(0.0, temp - 75.0)

            # Demand estimate
            tod = TOD_CURVE.get(hod, 1.0)
            base_demand = ERCOT_CAPACITY_MW * 0.45
            demand = (base_demand + hdh * 400 + cdh * 350) * tod

            # Renewable generation %
            wind_cf = min(1.0, wind / 25.0)
            renewable_pct = wind_cf * WIND_PENETRATION.get("ERCOT", 0.25) * 100

            # Grid utilization %
            grid_util_pct = min(100.0, (demand / ERCOT_CAPACITY_MW) * 100)

            # Rolling features (use rules prices as proxy)
            if h >= 24:
                rolling_price = float(np.mean(rules_prices[h - 24 : h]))
                rolling_temp = float(np.mean(temps[h - 24 : h]))
            elif h > 0:
                rolling_price = float(np.mean(rules_prices[:h]))
                rolling_temp = float(np.mean(temps[:h]))
            else:
                rolling_price = float(rules_prices[0])
                rolling_temp = float(temps[0])

            temp_change = float(temps[h] - temps[max(0, h - 6)]) if h >= 6 else 0.0

            features[h] = [
                temp,                           # temperature_f
                wind,                           # wind_speed_mph
                hod,                            # hour_of_day
                dt.weekday(),                   # day_of_week
                dt.month,                       # month
                int(dt.weekday() >= 5),         # is_weekend
                hdh,                            # heating_degree_hours
                cdh,                            # cooling_degree_hours
                demand,                         # demand_estimate_mw
                renewable_pct,                  # renewable_gen_pct
                grid_util_pct,                  # grid_utilization_pct
                rolling_price,                  # rolling_24h_avg_price
                rolling_temp,                   # rolling_24h_avg_temp
                temp_change,                    # temp_change_6h
                int(temp < 20),                 # is_extreme_cold
                int(temp > 100),                # is_extreme_heat
            ]

        return features

    # ── Forecasting ───────────────────────────────────────────────

    def get_price_forecast(
        self,
        region: str,
        mode: PricingMode,
        scenario: str = "normal",
        hours: int = 48,
    ) -> List[HourlyPrice]:
        """Generate hourly price forecast for a region."""
        base_price = BASE_PRICE_MWH.get(region, 35.0)
        wind_pen = WIND_PENETRATION.get(region, 0.1)
        is_uri = scenario == "uri_2021" and region == "ERCOT"
        now = datetime.now(timezone.utc)

        effective_mode = mode
        if mode in (PricingMode.ML, PricingMode.HYBRID) and self.model is None:
            effective_mode = PricingMode.RULES

        # ── Pre-compute raw arrays ──
        temps = np.zeros(hours)
        wind_mphs = np.zeros(hours)
        wind_factors = np.zeros(hours)

        for h in range(hours):
            hod = h % 24

            # Temperature
            if is_uri and h < len(URI_TEMP_PROFILE):
                temps[h] = URI_TEMP_PROFILE[h]
            else:
                temps[h] = 78.0 + 16.0 * math.sin(
                    2 * math.pi * (hod - 14) / 24
                )

            # Wind speed in mph (for ML features)
            if is_uri and h < len(URI_WIND_MPH):
                wind_mphs[h] = URI_WIND_MPH[h]
            else:
                wind_mphs[h] = NORMAL_WIND_MPH.get(hod, 10.0)

            # Wind factor (dimensionless, for rules engine)
            if is_uri and h < len(URI_WIND_FACTOR):
                wind_factors[h] = URI_WIND_FACTOR[h]
            else:
                wind_factors[h] = WIND_HOURLY_FACTOR.get(hod, 0.3) * wind_pen

        # ── Derived arrays ──
        hdhs = np.maximum(0.0, 65.0 - temps)
        cdhs = np.maximum(0.0, temps - 75.0)
        grid_utils = np.array([
            _estimate_grid_util(float(hdhs[h]), float(cdhs[h]), h % 24)
            for h in range(hours)
        ])

        # ── Rules prices (always computed: used for rolling features + fallback) ──
        rules_prices = np.array([
            _rules_price_raw(
                h % 24, float(temps[h]), float(wind_factors[h]),
                float(grid_utils[h]), base_price, is_uri,
            )
            for h in range(hours)
        ])

        # ── ML / hybrid prediction ──
        if effective_mode in (PricingMode.ML, PricingMode.HYBRID):
            ml_features = self._build_ml_features(
                hours, temps, wind_mphs, rules_prices
            )
            ml_prices = self.model.predict(ml_features)

            if effective_mode == PricingMode.HYBRID:
                final_prices = np.array([
                    _hybrid_blend(
                        float(ml_prices[h]), float(rules_prices[h]),
                        h % 24, float(wind_factors[h]), is_uri,
                    )
                    for h in range(hours)
                ])
            else:
                final_prices = ml_prices
        else:
            final_prices = rules_prices

        # ── Build HourlyPrice objects ──
        prices: List[HourlyPrice] = []
        for h in range(hours):
            hod = h % 24
            price_mwh = float(final_prices[h])
            # Wholesale → retail: utility markup + distribution charge
            consumer_kwh = round(max(0.0, price_mwh / 1000.0 * 2.2 + 0.04), 4)
            demand_factor = round(TOD_CURVE.get(hod, 1.0), 2)

            prices.append(HourlyPrice(
                hour=h,
                timestamp=now + timedelta(hours=h),
                price_mwh=round(price_mwh, 2),
                consumer_price_kwh=consumer_kwh,
                demand_factor=demand_factor,
                wind_gen_factor=round(float(wind_factors[h]), 4),
                grid_utilization_pct=round(float(grid_utils[h]) * 100, 1),
                zone=region,
                prediction_mode=effective_mode,
            ))

        return prices

    # ── Zone-adjusted forecast ─────────────────────────────────────

    def get_zone_price_forecast(
        self,
        region: str,
        zone: str,
        mode: PricingMode,
        scenario: str = "normal",
        hours: int = 48,
    ) -> List[HourlyPrice]:
        """Generate zone-adjusted price forecast.

        1. Compute base regional forecast.
        2. Apply structural zone multiplier.
        3. For live scenario, fetch zone weather and apply temp/wind adjustments.
        """
        base_prices = self.get_price_forecast(region, mode, scenario, hours)
        factor = ZONE_PRICE_FACTORS.get(zone, 1.0)

        # For live scenario, try to get zone-specific weather adjustments
        weather_adjustments: Optional[List[Dict[str, float]]] = None
        if scenario == "live" and zone in ZONE_COORDS:
            weather_adjustments = self._fetch_zone_weather(zone, hours)

        adjusted: List[HourlyPrice] = []
        for i, hp in enumerate(base_prices):
            price_mwh = hp.price_mwh * factor
            # Apply weather-based adjustments for live scenario
            if weather_adjustments and i < len(weather_adjustments):
                w = weather_adjustments[i]
                # Temperature stress: cold (<32F) or hot (>95F) pushes prices up
                temp_f = w.get("temp_f", 65.0)
                if temp_f < 32:
                    temp_stress = 1.0 + (32 - temp_f) * 0.005  # up to ~16% for 0F
                elif temp_f > 95:
                    temp_stress = 1.0 + (temp_f - 95) * 0.004
                else:
                    temp_stress = 1.0
                # Wind discount: more wind → cheaper power (especially in wind-rich zones)
                wind_mph = w.get("wind_mph", 10.0)
                wind_discount = max(0.90, 1.0 - (wind_mph / 40.0) * 0.15)
                price_mwh = price_mwh * temp_stress * wind_discount

            consumer_kwh = round(max(0.0, price_mwh / 1000.0 * 2.2 + 0.04), 4)

            adjusted.append(HourlyPrice(
                hour=hp.hour,
                timestamp=hp.timestamp,
                price_mwh=round(price_mwh, 2),
                consumer_price_kwh=consumer_kwh,
                demand_factor=hp.demand_factor,
                wind_gen_factor=hp.wind_gen_factor,
                grid_utilization_pct=hp.grid_utilization_pct,
                zone=zone,
                prediction_mode=hp.prediction_mode,
            ))

        return adjusted

    def _fetch_zone_weather(
        self, zone: str, hours: int
    ) -> Optional[List[Dict[str, float]]]:
        """Fetch hourly weather for a zone from Open-Meteo, with 15-min cache."""
        now = _time.time()
        if zone in _weather_cache:
            ts, data = _weather_cache[zone]
            if now - ts < _WEATHER_CACHE_TTL:
                return data[:hours]

        lat, lon = ZONE_COORDS[zone]
        try:
            resp = requests.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "hourly": "temperature_2m,wind_speed_10m",
                    "temperature_unit": "fahrenheit",
                    "wind_speed_unit": "mph",
                    "forecast_days": 3,
                },
                timeout=5,
            )
            resp.raise_for_status()
            data = resp.json()
            hourly = data.get("hourly", {})
            temps = hourly.get("temperature_2m", [])
            winds = hourly.get("wind_speed_10m", [])
            result = [
                {"temp_f": t, "wind_mph": w}
                for t, w in zip(temps, winds)
            ]
            _weather_cache[zone] = (now, result)
            return result[:hours]
        except Exception as e:
            logger.warning("Failed to fetch zone weather for %s: %s", zone, e)
            return None

    # ── Model info ────────────────────────────────────────────────

    def get_model_info(self) -> Dict[str, Any]:
        """Return model status information."""
        return {
            "model_loaded": self.model is not None,
            "training_date": self.training_date,
            "feature_names": self.feature_names,
            "training_score": self.training_score,
            "training_samples": self.training_samples,
        }


price_service = PriceService()
