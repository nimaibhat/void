"""Overview Service — aggregates grid nodes into 8 ERCOT weather zones for the operator left sidebar."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.models.utility import (
    NationalOverview,
    RegionOverview,
    RegionStatus,
    WeatherThreat,
)
from app.services import demand_service
from app.services.grid_graph_service import grid_graph

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

# Uri weather data per ERCOT weather zone
_URI_WEATHER: Dict[str, dict] = {
    "Coast":         {"temp_f": 20.0, "wind_mph": 25, "condition": "Freezing rain", "is_extreme": True},
    "East":          {"temp_f": 15.0, "wind_mph": 20, "condition": "Ice storm", "is_extreme": True},
    "Far West":      {"temp_f": 5.0,  "wind_mph": 40, "condition": "Blizzard", "is_extreme": True},
    "North":         {"temp_f": 2.0,  "wind_mph": 35, "condition": "Ice storm", "is_extreme": True},
    "North Central": {"temp_f": 8.0,  "wind_mph": 30, "condition": "Freezing rain", "is_extreme": True},
    "South Central": {"temp_f": 12.0, "wind_mph": 20, "condition": "Freezing rain", "is_extreme": True},
    "Southern":      {"temp_f": 22.0, "wind_mph": 18, "condition": "Sleet", "is_extreme": True},
    "West":          {"temp_f": 5.0,  "wind_mph": 35, "condition": "Blizzard", "is_extreme": True},
}

_NORMAL_WEATHER: Dict[str, dict] = {
    "Coast":         {"temp_f": 72.0, "wind_mph": 8,  "condition": "Clear", "is_extreme": False},
    "East":          {"temp_f": 68.0, "wind_mph": 10, "condition": "Partly cloudy", "is_extreme": False},
    "Far West":      {"temp_f": 60.0, "wind_mph": 15, "condition": "Clear", "is_extreme": False},
    "North":         {"temp_f": 65.0, "wind_mph": 12, "condition": "Partly cloudy", "is_extreme": False},
    "North Central": {"temp_f": 68.0, "wind_mph": 10, "condition": "Clear", "is_extreme": False},
    "South Central": {"temp_f": 70.0, "wind_mph": 7,  "condition": "Clear", "is_extreme": False},
    "Southern":      {"temp_f": 74.0, "wind_mph": 6,  "condition": "Clear", "is_extreme": False},
    "West":          {"temp_f": 62.0, "wind_mph": 15, "condition": "Windy", "is_extreme": False},
}


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
    forecast_hour = 36 if scenario == "uri" else 12
    multipliers = demand_service.compute_demand_multipliers(scenario, forecast_hour)

    weather_data = _URI_WEATHER if scenario == "uri" else _NORMAL_WEATHER

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

        w = weather_data.get(zone_id, _NORMAL_WEATHER["Coast"])

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
