"""Demand Forecast Service — converts weather temperatures to electricity
demand multipliers per grid node.

Uses heating/cooling degree-hours, a 24-hour time-of-day curve, and
regional sensitivity multipliers to compute how much load each node
actually draws under a given weather scenario.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Tuple

from app.services.grid_graph_service import grid_graph
from app.services.weather_service import CITIES

# ── Time-of-day load curve (hour → multiplier) ─────────────────────
# Peak 6-9 PM ≈ 1.15×, trough 3-5 AM ≈ 0.57×.

TOD_CURVE: Dict[int, float] = {
    0: 0.65, 1: 0.60, 2: 0.58, 3: 0.57, 4: 0.57, 5: 0.60,
    6: 0.70, 7: 0.80, 8: 0.90, 9: 0.95, 10: 0.98, 11: 1.00,
    12: 1.02, 13: 1.03, 14: 1.05, 15: 1.05, 16: 1.08, 17: 1.10,
    18: 1.15, 19: 1.15, 20: 1.12, 21: 1.05, 22: 0.90, 23: 0.78,
}

# ── Regional heating/cooling sensitivity ────────────────────────────
# ERCOT has high heating sensitivity due to poor winterization.

REGION_SENSITIVITY: Dict[str, Dict[str, float]] = {
    "ERCOT":  {"heat": 0.05,  "cool": 0.03},
    "PJM":    {"heat": 0.025, "cool": 0.03},
    "NYISO":  {"heat": 0.025, "cool": 0.03},
    "MISO":   {"heat": 0.03,  "cool": 0.03},
    "ISO-NE": {"heat": 0.025, "cool": 0.025},
    "CAISO":  {"heat": 0.02,  "cool": 0.04},
    "SPP":    {"heat": 0.035, "cool": 0.03},
}

# ── Hardcoded fallback temperatures for Uri (Feb 14–15 2021, ~h36) ──

URI_FALLBACK_TEMPS: Dict[str, float] = {
    "Austin, TX": 12.0,
    "Houston, TX": 18.0,
    "Dallas, TX": 8.0,
    "San Antonio, TX": 15.0,
    "Los Angeles, CA": 55.0,
    "New York, NY": 25.0,
    "Chicago, IL": 10.0,
}


# ── Helpers ─────────────────────────────────────────────────────────


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km (good enough for nearest-city lookup)."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def nearest_city(lat: float, lon: float) -> str:
    """Return the CITIES key closest to the given coordinate."""
    best_name = ""
    best_dist = float("inf")
    for name, (clat, clon) in CITIES.items():
        d = _haversine(lat, lon, clat, clon)
        if d < best_dist:
            best_dist = d
            best_name = name
    return best_name


# ── Public API ──────────────────────────────────────────────────────


def get_city_temps_for_hour(
    city_forecasts: Dict[str, Any] | None,
    forecast_hour: int,
) -> Dict[str, float]:
    """Extract per-city temperature at *forecast_hour*.

    Falls back to URI_FALLBACK_TEMPS if forecast data is unavailable.
    """
    if city_forecasts is None:
        return dict(URI_FALLBACK_TEMPS)

    cities_data: Dict[str, Any] = city_forecasts.get("cities", {})
    temps: Dict[str, float] = {}
    for city_name in CITIES:
        city = cities_data.get(city_name)
        if city is None:
            temps[city_name] = URI_FALLBACK_TEMPS.get(city_name, 65.0)
            continue

        # Find the hourly entry closest to forecast_hour.
        hourly: List[Dict[str, Any]] = city.get("hourly", [])
        best_entry = min(
            hourly,
            key=lambda h: abs(h["hour"] - forecast_hour),
            default=None,
        )
        temps[city_name] = (
            best_entry["temp_f"] if best_entry else URI_FALLBACK_TEMPS.get(city_name, 65.0)
        )

    return temps


def compute_demand_multipliers(
    city_temps: Dict[str, float],
    forecast_hour: int,
    region: str = "ERCOT",
) -> Dict[str, float]:
    """Compute demand multiplier for every node in the grid.

    Formula per node:
        demand = base_load × tod × (1 + heat_sens × hdh + cool_sens × cdh)

    where:
        hdh = max(0, 65 - temp_f)   (heating degree-hours)
        cdh = max(0, temp_f - 75)   (cooling degree-hours)
        tod = time-of-day curve value for the forecast hour
    """
    sens = REGION_SENSITIVITY.get(region, REGION_SENSITIVITY["ERCOT"])
    heat_sens = sens["heat"]
    cool_sens = sens["cool"]

    # TOD multiplier — use forecast_hour mod 24 for the diurnal curve.
    tod = TOD_CURVE.get(forecast_hour % 24, 1.0)

    multipliers: Dict[str, float] = {}

    for node_id in grid_graph.get_node_ids():
        node = grid_graph.graph.nodes[node_id]
        nlat = node["lat"]
        nlon = node["lon"]

        # Assign nearest city temperature.
        city = nearest_city(nlat, nlon)
        temp_f = city_temps.get(city, 65.0)

        hdh = max(0.0, 65.0 - temp_f)
        cdh = max(0.0, temp_f - 75.0)

        multiplier = tod * (1.0 + heat_sens * hdh + cool_sens * cdh)
        multipliers[node_id] = round(multiplier, 4)

    return multipliers
