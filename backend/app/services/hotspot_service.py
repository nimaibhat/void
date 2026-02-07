"""Hotspot Service — city-level severity markers and transmission arcs for the operator globe."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from app.models.grid import ArcsResponse, GridArc, GridHotspot, HotspotsResponse
from app.services import demand_service
from app.services.grid_graph_service import grid_graph

# ── City-level hotspots with real coordinates ───────────────────────

_HOTSPOT_CITIES: List[Dict[str, Any]] = [
    {"id": "HS-HOU", "name": "Houston", "lat": 29.76, "lon": -95.37, "cluster": "HOU"},
    {"id": "HS-DAL", "name": "Dallas", "lat": 32.78, "lon": -96.80, "cluster": "DAL"},
    {"id": "HS-AUS", "name": "Austin", "lat": 30.27, "lon": -97.74, "cluster": "AUS"},
    {"id": "HS-SAT", "name": "San Antonio", "lat": 29.42, "lon": -98.49, "cluster": "SAT"},
    {"id": "HS-CRP", "name": "Corpus Christi", "lat": 27.80, "lon": -97.40, "cluster": "CRP"},
    {"id": "HS-MID", "name": "Midland", "lat": 31.99, "lon": -102.08, "cluster": "WTX"},
    {"id": "HS-LBK", "name": "Lubbock", "lat": 33.58, "lon": -101.85, "cluster": "LBK"},
    {"id": "HS-ELP", "name": "El Paso", "lat": 31.76, "lon": -106.44, "cluster": "ELP"},
]

# Node prefix → hotspot cluster mapping (for aggregation)
_NODE_TO_HOTSPOT: Dict[str, str] = {
    "HOU": "HOU",
    "DAL": "DAL",
    "AUS": "AUS",
    "SAT": "SAT",
    "WTX": "WTX",
    "CRP": "CRP",
    "LBK": "LBK",
    "ELP": "ELP",
    "BEA": "HOU",
    "TYL": "DAL",
    "WCO": "AUS",
    "AMR": "WTX",
    "LRD": "SAT",
}

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
    if scenario == "uri":
        city_temps = demand_service.URI_FALLBACK_TEMPS
        forecast_hour = 36
    else:
        city_temps = {city: 65.0 for city in demand_service.URI_FALLBACK_TEMPS}
        forecast_hour = 12

    multipliers = demand_service.compute_demand_multipliers(
        city_temps, forecast_hour, region="ERCOT"
    )

    result: Dict[str, Tuple[float, float]] = {}
    for nid in grid_graph.get_node_ids():
        nd = grid_graph.graph.nodes[nid]
        load = nd["base_load_mw"] * multipliers.get(nid, 1.0)
        cap = nd["capacity_mw"]
        result[nid] = (load, cap)
    return result


def _status_for_cluster(cluster: str, node_loads: Dict[str, Tuple[float, float]]) -> Tuple[str, float, float, float]:
    """Aggregate status for a cluster of nodes. Returns (status, load, capacity, risk_pct)."""
    total_load = 0.0
    total_cap = 0.0

    for nid, (load, cap) in node_loads.items():
        prefix = nid.split("_")[0]
        mapped = _NODE_TO_HOTSPOT.get(prefix)
        if mapped == cluster:
            total_load += load
            total_cap += cap

    # For scattered single-node cities with no direct nodes, use small defaults
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
    """Return city-level hotspots with severity derived from node data."""
    node_loads = _get_node_loads(scenario)
    hotspots: List[GridHotspot] = []

    for city in _HOTSPOT_CITIES:
        status, load, cap, risk = _status_for_cluster(city["cluster"], node_loads)
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
    # Build a lookup of hotspot coords
    coords: Dict[str, Tuple[float, float]] = {}
    for city in _HOTSPOT_CITIES:
        coords[city["id"]] = (city["lat"], city["lon"])

    # Get node loads for utilization calculation
    node_loads = _get_node_loads(scenario)

    # Compute average utilization across the grid for arc scaling
    total_load = sum(l for l, c in node_loads.values())
    total_cap = sum(c for l, c in node_loads.values())
    grid_util = (total_load / total_cap * 100) if total_cap > 0 else 50.0

    arcs: List[GridArc] = []
    for arc_def in _ARC_DEFS:
        src = arc_def["source"]
        tgt = arc_def["target"]
        src_coords = coords[src]
        tgt_coords = coords[tgt]

        # Derive arc flow from average of source/target cluster loads
        src_cluster = next(c["cluster"] for c in _HOTSPOT_CITIES if c["id"] == src)
        tgt_cluster = next(c["cluster"] for c in _HOTSPOT_CITIES if c["id"] == tgt)

        src_status = _status_for_cluster(src_cluster, node_loads)
        tgt_status = _status_for_cluster(tgt_cluster, node_loads)

        # Arc capacity is proportional to the smaller cluster's capacity
        arc_cap = min(src_status[2], tgt_status[2]) * 0.3  # ~30% of cluster capacity
        if arc_cap == 0:
            arc_cap = 100.0

        # Flow based on grid utilization with some variation
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
