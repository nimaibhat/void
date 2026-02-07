"""Grid Service — orchestrates grid graph and demand data to produce
grid-status, topology, and cascade-probability responses.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

from app.services import demand_service
from app.services.cascade_service import run_cascade
from app.services.grid_graph_service import grid_graph

logger = logging.getLogger("blackout.grid_service")

DEFAULT_FORECAST_HOUR = 36


# ── Public API ──────────────────────────────────────────────────────


async def get_grid_status(
    scenario: str = "uri_2021",
    forecast_hour: int = DEFAULT_FORECAST_HOUR,
) -> Dict[str, Any]:
    """Compute grid status with demand from real ERCOT load data.

    1. Compute demand multipliers from ERCOT zone data.
    2. Apply to graph nodes, classify each node.
    3. Build summary stats.
    """
    multipliers = demand_service.compute_demand_multipliers(scenario, forecast_hour)

    nodes: List[Dict[str, Any]] = []
    stressed = failed = nominal = 0
    total_load = total_cap = 0.0

    for nid in grid_graph.get_node_ids():
        nd = grid_graph.graph.nodes[nid]
        base = nd["base_load_mw"]
        cap = nd["capacity_mw"]
        load = base * multipliers.get(nid, 1.0)
        pct = (load / cap * 100.0) if cap > 0 else 0.0

        if load > cap:
            status = "failed"
            failed += 1
        elif pct > 80:
            status = "stressed"
            stressed += 1
        else:
            status = "nominal"
            nominal += 1

        total_load += load
        total_cap += cap

        nodes.append(
            {
                "id": nid,
                "lat": nd["lat"],
                "lon": nd["lon"],
                "status": status,
                "load_pct": round(pct, 1),
                "load_mw": round(load, 1),
                "capacity_mw": round(cap, 1),
                "weather_zone": nd["weather_zone"],
            }
        )

    total = len(nodes)
    cascade_prob = round((stressed + failed) / total, 2) if total else 0.0

    return {
        "scenario": scenario,
        "forecast_hour": forecast_hour,
        "generated_at": datetime.now(timezone.utc),
        "nodes": nodes,
        "edges": grid_graph.get_edges_raw(),
        "summary": {
            "total_nodes": total,
            "stressed_count": stressed,
            "failed_count": failed,
            "nominal_count": nominal,
            "total_load_mw": round(total_load, 1),
            "total_capacity_mw": round(total_cap, 1),
            "cascade_probability": cascade_prob,
        },
    }


def get_topology() -> Dict[str, Any]:
    """Raw grid graph for frontend globe rendering."""
    raw = grid_graph.get_topology()
    return {
        "total_nodes": len(raw["nodes"]),
        "total_edges": len(raw["edges"]),
        "region": "ERCOT",
        "nodes": raw["nodes"],
        "edges": raw["edges"],
    }


def get_node_detail(node_id: str) -> Dict[str, Any] | None:
    """Detailed info for a single node."""
    nd = grid_graph.get_node(node_id)
    if nd is None:
        return None

    cap = nd["capacity_mw"]
    load = nd["base_load_mw"]
    pct = (load / cap * 100.0) if cap > 0 else 0.0

    if pct > 100:
        status = "failed"
    elif pct > 80:
        status = "stressed"
    else:
        status = "nominal"

    if pct > 100:
        risk = "critical"
    elif pct > 80:
        risk = "high"
    elif pct > 60:
        risk = "medium"
    else:
        risk = "low"

    return {
        "id": nd["id"],
        "lat": nd["lat"],
        "lon": nd["lon"],
        "load_mw": round(load, 1),
        "capacity_mw": round(cap, 1),
        "load_pct": round(pct, 1),
        "status": status,
        "voltage_kv": nd["voltage_kv"],
        "region": nd["region"],
        "weather_zone": nd.get("weather_zone", "Unknown"),
        "connected_nodes": nd["connected_nodes"],
        "risk_level": risk,
    }


async def get_cascade_probability(
    scenario: str = "uri_2021",
    forecast_hour: int = DEFAULT_FORECAST_HOUR,
) -> Dict[str, Any]:
    """Cascade probability for ERCOT from real load data."""
    multipliers = demand_service.compute_demand_multipliers(scenario, forecast_hour)

    total = 0
    above_80 = 0
    for nid in grid_graph.get_node_ids():
        nd = grid_graph.graph.nodes[nid]
        load = nd["base_load_mw"] * multipliers.get(nid, 1.0)
        cap = nd["capacity_mw"]
        pct = (load / cap * 100) if cap > 0 else 0
        total += 1
        if pct > 80:
            above_80 += 1

    ercot_prob = round(above_80 / total, 2) if total else 0.0

    return {
        "probabilities": {
            "ERCOT": ercot_prob,
            "WECC": 0.12,
            "PJM": 0.18,
            "NYISO": 0.05,
            "MISO": 0.08,
            "ISO-NE": 0.03,
            "SPP": 0.06,
        },
        "forecast_hour": forecast_hour,
        "scenario": scenario,
    }
