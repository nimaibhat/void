"""Hotspot Service — city-level severity markers and transmission arcs for the operator globe.

Uses ERCOT weather zone aggregation from the ACTIVSg2000 grid.
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from app.models.grid import ArcsResponse, GridArc, GridHotspot, HotspotsResponse
from app.services import demand_service
from app.services.grid_graph_service import grid_graph

# ── City-level hotspots mapped to ERCOT weather zones ───────────────

_HOTSPOT_CITIES: List[Dict[str, Any]] = [
    {"id": "HS-HOU", "name": "Houston",        "lat": 29.76, "lon": -95.37, "weather_zone": "Coast"},
    {"id": "HS-DAL", "name": "Dallas",          "lat": 32.78, "lon": -96.80, "weather_zone": "North Central"},
    {"id": "HS-AUS", "name": "Austin",          "lat": 30.27, "lon": -97.74, "weather_zone": "South Central"},
    {"id": "HS-SAT", "name": "San Antonio",     "lat": 29.42, "lon": -98.49, "weather_zone": "South Central"},
    {"id": "HS-CRP", "name": "Corpus Christi",  "lat": 27.80, "lon": -97.40, "weather_zone": "Southern"},
    {"id": "HS-MID", "name": "Midland",         "lat": 31.99, "lon": -102.08, "weather_zone": "Far West"},
    {"id": "HS-LBK", "name": "Lubbock",         "lat": 33.58, "lon": -101.85, "weather_zone": "West"},
    {"id": "HS-ELP", "name": "El Paso",         "lat": 31.76, "lon": -106.44, "weather_zone": "Far West"},
]

# ── Transmission corridors ──────────────────────────────────────────

_ARC_DEFS: List[Dict[str, Any]] = [
    {"source": "HS-HOU", "target": "HS-DAL"},
    {"source": "HS-HOU", "target": "HS-AUS"},
    {"source": "HS-HOU", "target": "HS-SAT"},
    {"source": "HS-AUS", "target": "HS-SAT"},
    {"source": "HS-AUS", "target": "HS-DAL"},
    {"source": "HS-DAL", "target": "HS-MID"},
    {"source": "HS-MID", "target": "HS-ELP"},
    {"source": "HS-MID", "target": "HS-LBK"},
    {"source": "HS-SAT", "target": "HS-CRP"},
    {"source": "HS-DAL", "target": "HS-LBK"},
]


def _get_node_loads(scenario: str) -> Dict[str, Tuple[float, float]]:
    """Return {node_id: (load_mw, capacity_mw)} for all nodes."""
    forecast_hour = 36 if scenario == "uri" else 12
    multipliers = demand_service.compute_demand_multipliers(scenario, forecast_hour)

    result: Dict[str, Tuple[float, float]] = {}
    for nid in grid_graph.get_node_ids():
        nd = grid_graph.graph.nodes[nid]
        load = nd["base_load_mw"] * multipliers.get(nid, 1.0)
        cap = nd["capacity_mw"]
        result[nid] = (load, cap)
    return result


def _status_for_zone(zone: str, node_loads: Dict[str, Tuple[float, float]]) -> Tuple[str, float, float, float]:
    """Aggregate status for a weather zone. Returns (status, load, capacity, risk_pct)."""
    total_load = 0.0
    total_cap = 0.0

    zone_node_ids = grid_graph.get_nodes_in_weather_zone(zone)
    for nid in zone_node_ids:
        if nid in node_loads:
            load, cap = node_loads[nid]
            total_load += load
            total_cap += cap

    if total_cap == 0:
        return ("normal", 0.0, 0.0, 0.0)

    util = total_load / total_cap * 100
    risk = min(util, 100.0)

    if util >= 95:
        status = "critical"
    elif util >= 75:
        status = "stressed"
    else:
        status = "normal"

    return (status, round(total_load, 1), round(total_cap, 1), round(risk, 1))


def get_hotspots(scenario: str = "uri") -> HotspotsResponse:
    """Return city-level hotspots with severity derived from weather zone data."""
    node_loads = _get_node_loads(scenario)
    hotspots: List[GridHotspot] = []

    for city in _HOTSPOT_CITIES:
        status, load, cap, risk = _status_for_zone(city["weather_zone"], node_loads)
        hotspots.append(GridHotspot(
            id=city["id"],
            name=city["name"],
            lat=city["lat"],
            lon=city["lon"],
            status=status,
            load_mw=load,
            capacity_mw=cap,
            outage_risk_pct=risk,
        ))

    return HotspotsResponse(hotspots=hotspots, scenario=scenario)


def get_arcs(scenario: str = "uri") -> ArcsResponse:
    """Return transmission arcs between hotspot cities."""
    coords: Dict[str, Tuple[float, float]] = {}
    for city in _HOTSPOT_CITIES:
        coords[city["id"]] = (city["lat"], city["lon"])

    node_loads = _get_node_loads(scenario)

    # Compute average utilization across the grid for arc scaling
    total_load = sum(load for load, cap in node_loads.values())
    total_cap = sum(cap for load, cap in node_loads.values())
    grid_util = (total_load / total_cap * 100) if total_cap > 0 else 50.0

    arcs: List[GridArc] = []
    for arc_def in _ARC_DEFS:
        src = arc_def["source"]
        tgt = arc_def["target"]
        src_coords = coords[src]
        tgt_coords = coords[tgt]

        src_zone = next(c["weather_zone"] for c in _HOTSPOT_CITIES if c["id"] == src)
        tgt_zone = next(c["weather_zone"] for c in _HOTSPOT_CITIES if c["id"] == tgt)

        src_status = _status_for_zone(src_zone, node_loads)
        tgt_status = _status_for_zone(tgt_zone, node_loads)

        # Arc capacity proportional to smaller zone's capacity
        arc_cap = min(src_status[2], tgt_status[2]) * 0.3
        if arc_cap == 0:
            arc_cap = 100.0

        flow = arc_cap * (grid_util / 100)
        util_pct = round(min(flow / arc_cap * 100, 100), 1)

        if util_pct >= 90:
            status = "critical"
        elif util_pct >= 70:
            status = "stressed"
        else:
            status = "normal"

        arcs.append(GridArc(
            source=src,
            target=tgt,
            source_coords=list(src_coords),
            target_coords=list(tgt_coords),
            flow_mw=round(flow, 1),
            capacity_mw=round(arc_cap, 1),
            utilization_pct=util_pct,
            status=status,
        ))

    return ArcsResponse(arcs=arcs, scenario=scenario)
