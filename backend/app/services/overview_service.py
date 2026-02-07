"""Overview Service — aggregates grid nodes into 8 ERCOT weather zones for the operator left sidebar."""

from __future__ import annotations

import logging
import requests
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.models.utility import (
    NationalOverview,
    RegionOverview,
    RegionStatus,
    WeatherThreat,
)
from app.services import demand_service
from app.services.demand_service import _fetch_zone_weather
from app.services.grid_graph_service import grid_graph, ZONE_CENTROIDS

logger = logging.getLogger("blackout.overview_service")

# ── Weather zone display names ──────────────────────────────────────

_ZONES: Dict[str, str] = {
    "Coast": "Coast",
    "East": "East",
    "Far West": "Far West",
    "North": "North",
    "North Central": "North Central",
    "South Central": "South Central",
    "Southern": "Southern",
    "West": "West",
}

# ── Weather classification ─────────────────────────────────────────

_HISTORICAL_API = "https://archive-api.open-meteo.com/v1/archive"

# Cache so we only fetch once per server lifetime
_uri_weather_cache: Optional[Dict[str, dict]] = None
_normal_weather_cache: Optional[Dict[str, dict]] = None


def _classify_weather(temp_f: float, wind_mph: float) -> tuple[str, bool]:
    """Derive a human-readable condition + is_extreme flag from temp & wind."""
    if temp_f <= 5 and wind_mph >= 25:
        return "Blizzard", True
    if temp_f <= 5 and wind_mph >= 10:
        return "Ice storm", True
    if temp_f <= 5:
        return "Severe freeze", True
    if temp_f <= 15 and wind_mph >= 15:
        return "Ice storm", True
    if temp_f <= 15:
        return "Hard freeze", True
    if temp_f <= 25:
        return "Freezing rain", True
    if temp_f <= 32:
        return "Near freezing", temp_f <= 28
    if temp_f >= 105:
        return "Extreme heat", True
    if temp_f >= 95:
        return "Heat advisory", True
    if wind_mph >= 35:
        return "High winds", True
    if wind_mph >= 20:
        return "Windy", False
    if temp_f >= 85:
        return "Hot", False
    return "Clear", False


def _fetch_historical_weather(date: str) -> Dict[str, dict]:
    """Fetch actual historical weather for a specific date from Open-Meteo Archive API.

    Parameters
    ----------
    date : str
        ISO date like "2021-02-15"

    Returns {zone_name: {temp_f, wind_mph, condition, is_extreme}}
    """
    result: Dict[str, dict] = {}

    for zone_name, (lat, lon) in ZONE_CENTROIDS.items():
        params = {
            "latitude": lat,
            "longitude": lon,
            "start_date": date,
            "end_date": date,
            "hourly": "temperature_2m,wind_speed_10m",
            "temperature_unit": "fahrenheit",
            "wind_speed_unit": "mph",
            "timezone": "America/Chicago",
        }
        try:
            resp = requests.get(_HISTORICAL_API, params=params, timeout=15)
            resp.raise_for_status()
            hourly = resp.json()["hourly"]

            temps = hourly["temperature_2m"]
            winds = hourly["wind_speed_10m"]
            # Use the worst hour (min temp) to represent the day's crisis
            min_idx = temps.index(min(temps))
            temp_f = temps[min_idx]
            wind_mph = winds[min_idx]
        except Exception as exc:
            logger.error("Historical weather fetch failed for %s: %s", zone_name, exc)
            temp_f, wind_mph = 10.0, 25.0  # fallback to approximate Uri conditions

        condition, is_extreme = _classify_weather(temp_f, wind_mph)
        result[zone_name] = {
            "temp_f": round(temp_f, 1),
            "wind_mph": round(wind_mph, 1),
            "condition": condition,
            "is_extreme": is_extreme,
        }

    return result


def _get_uri_weather() -> Dict[str, dict]:
    """Get actual Feb 15, 2021 weather (peak of Winter Storm Uri). Cached after first fetch."""
    global _uri_weather_cache
    if _uri_weather_cache is not None:
        return _uri_weather_cache
    logger.info("Fetching historical Uri weather from Open-Meteo...")
    _uri_weather_cache = _fetch_historical_weather("2021-02-15")
    return _uri_weather_cache


def _get_normal_weather() -> Dict[str, dict]:
    """Get actual Feb 1, 2021 weather (normal baseline). Cached after first fetch."""
    global _normal_weather_cache
    if _normal_weather_cache is not None:
        return _normal_weather_cache
    logger.info("Fetching historical normal weather from Open-Meteo...")
    _normal_weather_cache = _fetch_historical_weather("2021-02-01")
    return _normal_weather_cache


def _build_live_weather() -> Dict[str, dict]:
    """Fetch current-hour weather from Open-Meteo and map to the overview format."""
    try:
        zone_weather = _fetch_zone_weather(forecast_hours=1)
    except Exception as exc:
        logger.error("Failed to fetch live weather, falling back to normal: %s", exc)
        return _get_normal_weather()

    result: Dict[str, dict] = {}
    for zone_name, records in zone_weather.items():
        if not records:
            result[zone_name] = _get_normal_weather().get(zone_name, {"temp_f": 70, "wind_mph": 10, "condition": "Clear", "is_extreme": False})
            continue
        r = records[0]
        temp_f = r.get("temperature_f", 70.0)
        wind_mph = r.get("wind_speed_mph", 10.0)
        condition, is_extreme = _classify_weather(temp_f, wind_mph)

        result[zone_name] = {
            "temp_f": round(temp_f, 1),
            "wind_mph": round(wind_mph, 1),
            "condition": condition,
            "is_extreme": is_extreme,
        }
    return result


def _status_from_utilization(pct: float) -> RegionStatus:
    if pct >= 95:
        return RegionStatus.BLACKOUT
    if pct >= 85:
        return RegionStatus.CRITICAL
    if pct >= 70:
        return RegionStatus.STRESSED
    return RegionStatus.NORMAL


_STATUS_RANK = {
    RegionStatus.NORMAL: 0,
    RegionStatus.STRESSED: 1,
    RegionStatus.CRITICAL: 2,
    RegionStatus.BLACKOUT: 3,
}


def get_overview(scenario: str = "uri") -> NationalOverview:
    """Build national overview aggregated from grid nodes by ERCOT weather zone."""
    if scenario == "uri":
        forecast_hour = 36
    elif scenario == "live":
        forecast_hour = 0
    else:
        forecast_hour = 12
    multipliers = demand_service.compute_demand_multipliers(scenario, forecast_hour)

    if scenario == "uri":
        weather_data = _get_uri_weather()
    elif scenario == "live":
        weather_data = _build_live_weather()
    else:
        weather_data = _get_normal_weather()

    # Aggregate nodes by weather zone
    zone_loads: Dict[str, float] = {z: 0.0 for z in _ZONES}
    zone_caps: Dict[str, float] = {z: 0.0 for z in _ZONES}
    zone_failed: Dict[str, int] = {z: 0 for z in _ZONES}

    for nid in grid_graph.get_node_ids():
        nd = grid_graph.graph.nodes[nid]
        wz = nd["weather_zone"]
        if wz not in _ZONES:
            continue
        base = nd["base_load_mw"]
        cap = nd["capacity_mw"]
        load = base * multipliers.get(nid, 1.0)

        zone_loads[wz] += load
        zone_caps[wz] += cap
        if load > cap:
            zone_failed[wz] += 1

    # Build region overviews
    regions: List[RegionOverview] = []
    worst_status = RegionStatus.NORMAL

    for zone_id, name in _ZONES.items():
        load = zone_loads[zone_id]
        cap = zone_caps[zone_id]
        util = round((load / cap * 100) if cap > 0 else 0.0, 1)
        status = _status_from_utilization(util)

        if _STATUS_RANK[status] > _STATUS_RANK[worst_status]:
            worst_status = status

        shortfall = max(0, load - cap)
        affected = int(shortfall * 500)
        outages = zone_failed[zone_id]

        w = weather_data.get(zone_id, {"temp_f": 70, "wind_mph": 10, "condition": "Clear", "is_extreme": False})

        regions.append(RegionOverview(
            region_id=zone_id,
            name=name,
            status=status,
            load_mw=round(load, 1),
            capacity_mw=round(cap, 1),
            utilization_pct=util,
            weather=WeatherThreat(**w),
            outage_count=outages,
            affected_customers=affected,
        ))

    total_load = sum(zone_loads.values())
    total_cap = sum(zone_caps.values())

    # Frequency model
    freq = 60.0
    for r in regions:
        if r.status == RegionStatus.STRESSED:
            freq -= 0.1
        elif r.status == RegionStatus.CRITICAL:
            freq -= 0.3
        elif r.status == RegionStatus.BLACKOUT:
            freq -= 0.5

    return NationalOverview(
        national_status=worst_status,
        grid_frequency_hz=round(max(freq, 59.0), 2),
        total_load_mw=round(total_load, 1),
        total_capacity_mw=round(total_cap, 1),
        regions=regions,
        timestamp=datetime.now(timezone.utc),
    )


def get_region(region_id: str, scenario: str = "uri") -> Optional[RegionOverview]:
    """Return a single region's overview, or None if not found."""
    overview = get_overview(scenario)
    for r in overview.regions:
        if r.region_id == region_id:
            return r
    return None
