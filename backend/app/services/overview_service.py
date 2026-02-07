"""Overview Service — aggregates grid nodes into 5 ERCOT regions for the operator left sidebar."""

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

# ── Region definitions (cluster prefix → display name) ──────────────

_REGIONS: Dict[str, str] = {
    "HOU": "Houston",
    "DAL": "Dallas-Fort Worth",
    "AUS": "Austin",
    "SAT": "San Antonio",
    "WTX": "West Texas",
}

# Scattered nodes map to nearest region
_SCATTERED_TO_REGION: Dict[str, str] = {
    "CRP": "SAT",  # Corpus Christi → San Antonio region
    "LBK": "WTX",  # Lubbock → West Texas
    "ELP": "WTX",  # El Paso → West Texas
    "BEA": "HOU",  # Beaumont → Houston
    "TYL": "DAL",  # Tyler → Dallas
    "WCO": "AUS",  # Waco → Austin
    "AMR": "WTX",  # Amarillo → West Texas
    "LRD": "SAT",  # Laredo → San Antonio
}

# Uri weather data per region
_URI_WEATHER: Dict[str, dict] = {
    "HOU": {"temp_f": 18.0, "wind_mph": 25, "condition": "Freezing rain", "is_extreme": True},
    "DAL": {"temp_f": 8.0, "wind_mph": 35, "condition": "Ice storm", "is_extreme": True},
    "AUS": {"temp_f": 12.0, "wind_mph": 20, "condition": "Freezing rain", "is_extreme": True},
    "SAT": {"temp_f": 15.0, "wind_mph": 18, "condition": "Sleet", "is_extreme": True},
    "WTX": {"temp_f": 5.0, "wind_mph": 40, "condition": "Blizzard", "is_extreme": True},
}

_NORMAL_WEATHER: Dict[str, dict] = {
    "HOU": {"temp_f": 72.0, "wind_mph": 8, "condition": "Clear", "is_extreme": False},
    "DAL": {"temp_f": 68.0, "wind_mph": 10, "condition": "Partly cloudy", "is_extreme": False},
    "AUS": {"temp_f": 70.0, "wind_mph": 7, "condition": "Clear", "is_extreme": False},
    "SAT": {"temp_f": 74.0, "wind_mph": 6, "condition": "Clear", "is_extreme": False},
    "WTX": {"temp_f": 65.0, "wind_mph": 15, "condition": "Windy", "is_extreme": False},
}


def _node_region(node_id: str) -> str:
    """Determine which region a node belongs to."""
    prefix = node_id.split("_")[0]
    if prefix in _REGIONS:
        return prefix
    return _SCATTERED_TO_REGION.get(prefix, "WTX")


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
    """Build national overview aggregated from grid nodes."""
    # Get demand multipliers for the scenario
    if scenario == "uri":
        city_temps = demand_service.URI_FALLBACK_TEMPS
    else:
        city_temps = {city: 65.0 for city in demand_service.URI_FALLBACK_TEMPS}

    forecast_hour = 36 if scenario == "uri" else 12
    multipliers = demand_service.compute_demand_multipliers(
        city_temps, forecast_hour, region="ERCOT"
    )

    weather_data = _URI_WEATHER if scenario == "uri" else _NORMAL_WEATHER

    # Aggregate nodes by region
    region_loads: Dict[str, float] = {r: 0.0 for r in _REGIONS}
    region_caps: Dict[str, float] = {r: 0.0 for r in _REGIONS}
    region_failed: Dict[str, int] = {r: 0 for r in _REGIONS}

    for nid in grid_graph.get_node_ids():
        nd = grid_graph.graph.nodes[nid]
        region = _node_region(nid)
        base = nd["base_load_mw"]
        cap = nd["capacity_mw"]
        load = base * multipliers.get(nid, 1.0)

        region_loads[region] = region_loads.get(region, 0.0) + load
        region_caps[region] = region_caps.get(region, 0.0) + cap
        if load > cap:
            region_failed[region] = region_failed.get(region, 0) + 1

    # Build region overviews
    regions: List[RegionOverview] = []
    worst_status = RegionStatus.NORMAL

    for region_id, name in _REGIONS.items():
        load = region_loads[region_id]
        cap = region_caps[region_id]
        util = round((load / cap * 100) if cap > 0 else 0.0, 1)
        status = _status_from_utilization(util)

        if _STATUS_RANK[status] > _STATUS_RANK[worst_status]:
            worst_status = status

        # Estimate affected customers: capacity shortfall × 500 homes/MW
        shortfall = max(0, load - cap)
        affected = int(shortfall * 500)
        outages = region_failed[region_id]

        w = weather_data.get(region_id, _NORMAL_WEATHER["HOU"])

        regions.append(RegionOverview(
            region_id=region_id,
            name=name,
            status=status,
            load_mw=round(load, 1),
            capacity_mw=round(cap, 1),
            utilization_pct=util,
            weather=WeatherThreat(**w),
            outage_count=outages,
            affected_customers=affected,
        ))

    total_load = sum(region_loads.values())
    total_cap = sum(region_caps.values())

    # Frequency model: 60.0 - penalties for stressed/critical/blackout regions
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
        if r.region_id == region_id.upper():
            return r
    return None
