"""Demand Service — distributes load data proportionally across buses
by their base Pd values.

Three scenario modes:
  - "uri" / "uri_2021" : Historical ERCOT data from Native_Load_2021.xlsx
  - "normal"           : Baseline ERCOT data from Feb 1 2021
  - "live"             : Real-time weather → ML model → predicted demand
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import requests

from app.services.ercot_data_service import ercot_data
from app.services.grid_graph_service import grid_graph, ZONE_CENTROIDS

logger = logging.getLogger("blackout.demand")

# ── Time-of-day load curve (hour → multiplier) ─────────────────────
# Kept here because price_service imports it for price modeling.

TOD_CURVE: Dict[int, float] = {
    0: 0.65, 1: 0.60, 2: 0.58, 3: 0.57, 4: 0.57, 5: 0.60,
    6: 0.70, 7: 0.80, 8: 0.90, 9: 0.95, 10: 0.98, 11: 1.00,
    12: 1.02, 13: 1.03, 14: 1.05, 15: 1.05, 16: 1.08, 17: 1.10,
    18: 1.15, 19: 1.15, 20: 1.12, 21: 1.05, 22: 0.90, 23: 0.78,
}

# During Uri, actual demand was ~45% higher than served load due to forced
# load shedding. This factor restores the uncurtailed demand estimate.
# Historical peak: ~69 GW actual demand vs ~47.5 GW served = 1.45x multiplier
URI_DEMAND_UPLIFT = 1.45

# ── ML model (lazy-loaded) ─────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
MODEL_PATH = PROJECT_ROOT / "models" / "load_model.pkl"

# Feature columns expected by the trained RandomForest
_FEATURE_COLS = [
    "temperature_f", "feels_like_f", "HDD", "CDD",
    "wind_speed_mph", "humidity_pct",
    "hour", "day_of_week", "month", "is_weekend",
]

BALANCE_POINT_F = 65

_ml_model: Optional[Any] = None


def _load_ml_model() -> Optional[Any]:
    """Lazy-load the trained RandomForest model from disk."""
    global _ml_model
    if _ml_model is not None:
        return _ml_model

    if not MODEL_PATH.exists():
        logger.warning("ML model not found at %s — run scripts/weather_to_load.py --train-only first", MODEL_PATH)
        return None

    import joblib
    _ml_model = joblib.load(MODEL_PATH)
    logger.info("Loaded ML load model from %s", MODEL_PATH)
    return _ml_model


# ── Live weather fetch (per zone centroid) ─────────────────────────

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


def _fetch_zone_weather(forecast_hours: int = 48) -> Dict[str, List[Dict[str, float]]]:
    """Fetch hourly weather for each ERCOT zone centroid from Open-Meteo.

    Returns {zone_name: [{hour, temperature_f, feels_like_f, humidity_pct, wind_speed_mph}, ...]}.
    """
    zone_weather: Dict[str, List[Dict[str, float]]] = {}

    for zone_name, (lat, lon) in ZONE_CENTROIDS.items():
        params = {
            "latitude": lat,
            "longitude": lon,
            "hourly": "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m",
            "temperature_unit": "fahrenheit",
            "wind_speed_unit": "mph",
            "forecast_hours": forecast_hours,
            "timezone": "America/Chicago",
        }
        try:
            resp = requests.get(OPEN_METEO_URL, params=params, timeout=15)
            resp.raise_for_status()
            hourly = resp.json()["hourly"]

            records = []
            for i, ts in enumerate(hourly["time"]):
                records.append({
                    "timestamp": ts,
                    "temperature_f": hourly["temperature_2m"][i],
                    "feels_like_f": hourly["apparent_temperature"][i],
                    "humidity_pct": hourly["relative_humidity_2m"][i],
                    "wind_speed_mph": hourly["wind_speed_10m"][i],
                })
            zone_weather[zone_name] = records
        except Exception as exc:
            logger.error("Failed to fetch weather for zone %s: %s", zone_name, exc)
            zone_weather[zone_name] = []

    return zone_weather


def _predict_zone_demand(zone_weather: Dict[str, List[Dict[str, float]]],
                         forecast_hour: int) -> Dict[str, float]:
    """Use the ML model to predict demand (MW) for each ERCOT zone at a given hour.

    The ML model predicts total ERCOT demand from weather at a single point.
    We run it per-zone to get relative zone-level demand, then scale so the
    total matches the model's prediction for the grid-wide average weather.
    """
    model = _load_ml_model()
    if model is None:
        logger.warning("ML model unavailable, falling back to default multipliers")
        return {}

    zone_demands: Dict[str, float] = {}

    for zone_name, records in zone_weather.items():
        if not records or forecast_hour >= len(records):
            continue

        rec = records[forecast_hour]
        ts = datetime.fromisoformat(rec["timestamp"])
        temp = rec["temperature_f"]
        feels = rec["feels_like_f"]
        hdd = max(0, BALANCE_POINT_F - temp)
        cdd = max(0, temp - BALANCE_POINT_F)

        features = np.array([[
            temp,
            feels,
            hdd,
            cdd,
            rec["wind_speed_mph"],
            rec["humidity_pct"],
            ts.hour,
            ts.weekday(),
            ts.month,
            1 if ts.weekday() >= 5 else 0,
        ]])

        pred = model.predict(features)[0]
        zone_demands[zone_name] = max(0, pred)

    if not zone_demands:
        return {}

    # The model predicts total ERCOT demand from single-point weather.
    # Normalize: distribute as proportional shares of the sum.
    # Each zone's share = zone_pred / sum(all zone_preds) * avg_prediction * n_zones
    # This preserves relative zone stress while using realistic total demand.
    total_pred = sum(zone_demands.values())
    n_zones = len(zone_demands)
    avg_pred = total_pred / n_zones  # representative total ERCOT demand

    for zone_name in zone_demands:
        share = zone_demands[zone_name] / total_pred
        zone_demands[zone_name] = share * avg_pred

    return zone_demands


# ── Main entry point ───────────────────────────────────────────────


def compute_demand_multipliers(
    scenario: str = "uri",
    forecast_hour: int = 36,
) -> Dict[str, float]:
    """Compute demand multiplier for every node in the grid.

    Scenarios:
      - "uri" / "uri_2021" : Historical ERCOT load from 2021 xlsx
      - "normal"           : Baseline ERCOT load from Feb 1 2021
      - "live"             : Real-time weather → ML model → predicted demand
    """
    if scenario == "live":
        return _compute_live_multipliers(forecast_hour)

    # ── Historical path (uri / normal) ──
    zone_loads = ercot_data.get_scenario_loads(scenario, forecast_hour)

    if not zone_loads:
        logger.warning("No ERCOT load data for scenario=%s hour=%d, using defaults", scenario, forecast_hour)
        if scenario in ("uri", "uri_2021"):
            return {nid: 2.5 for nid in grid_graph.get_node_ids()}
        return {nid: 1.0 for nid in grid_graph.get_node_ids()}

    # For Uri: uplift served load to estimate true demand
    uplift = URI_DEMAND_UPLIFT if scenario in ("uri", "uri_2021") else 1.0

    return _distribute_zone_loads(zone_loads, uplift)


def _compute_live_multipliers(forecast_hour: int) -> Dict[str, float]:
    """Fetch live weather, predict demand via ML, compute per-node multipliers."""
    logger.info("Computing live demand multipliers (forecast_hour=%d)", forecast_hour)

    zone_weather = _fetch_zone_weather(forecast_hours=48)
    zone_demands = _predict_zone_demand(zone_weather, forecast_hour)

    if not zone_demands:
        logger.warning("Live prediction failed, falling back to default multipliers")
        return {nid: 1.0 for nid in grid_graph.get_node_ids()}

    return _distribute_zone_loads(zone_demands, uplift=1.0)


def _distribute_zone_loads(zone_loads: Dict[str, float],
                           uplift: float = 1.0) -> Dict[str, float]:
    """Distribute zone-level MW loads to per-node multipliers proportionally."""
    # Compute total base load per weather zone
    zone_base_totals: Dict[str, float] = {}
    for zone_name in grid_graph.get_weather_zones():
        total = 0.0
        for nid in grid_graph.get_nodes_in_weather_zone(zone_name):
            total += grid_graph.graph.nodes[nid]["base_load_mw"]
        zone_base_totals[zone_name] = total

    # Compute per-node multipliers
    multipliers: Dict[str, float] = {}
    for nid in grid_graph.get_node_ids():
        nd = grid_graph.graph.nodes[nid]
        wz = nd["weather_zone"]
        base_total = zone_base_totals.get(wz, 0.0)
        actual_load = zone_loads.get(wz, 0.0) * uplift

        if base_total > 0 and actual_load > 0:
            multiplier = actual_load / base_total
        else:
            multiplier = 1.0

        multipliers[nid] = round(multiplier, 4)

    return multipliers
