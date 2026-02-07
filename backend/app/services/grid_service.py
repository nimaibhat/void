"""Grid Service — orchestrates grid graph, demand, and weather data
to produce grid-status, topology, and cascade-probability responses.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

from app.services import demand_service
from app.services.cascade_service import run_cascade
from app.services.grid_graph_service import grid_graph
from app.services.weather_service import weather_service

logger = logging.getLogger("blackout.grid_service")

# ── Scenario → start_time mapping (for named scenarios) ────────────

SCENARIO_START_TIMES: Dict[str, str] = {
    "uri_2021": "2021-02-13T00:00:00",
}

DEFAULT_FORECAST_HOUR = 36


# ── Public API ──────────────────────────────────────────────────────


async def get_grid_status(
    scenario: str = "uri_2021",
    forecast_hour: int = DEFAULT_FORECAST_HOUR,
) -> Dict[str, Any]:
    """Compute grid status with demand applied from a weather scenario.

    1. Fetch city temperatures (from weather service or fallback).
    2. Compute demand multipliers.
    3. Apply to graph nodes, classify each node.
    4. Build summary stats.
    """
    city_temps = await _get_city_temps(scenario, forecast_hour)
    multipliers = demand_service.compute_demand_multipliers(
        city_temps, forecast_hour, region="ERCOT"
    )

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
            }
        )

    total = len(nodes)
    # Cascade probability = fraction of nodes above 80 % load.
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
    load = nd["base_load_mw"]  # base load (no scenario applied)
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
        "connected_nodes": nd["connected_nodes"],
        "risk_level": risk,
    }


async def get_cascade_probability(
    scenario: str = "uri_2021",
    forecast_hour: int = DEFAULT_FORECAST_HOUR,
) -> Dict[str, Any]:
    """Cascade probability per ISO region.

    Computed for ERCOT from the actual grid; other regions use mock values.
    """
    city_temps = await _get_city_temps(scenario, forecast_hour)
    multipliers = demand_service.compute_demand_multipliers(
        city_temps, forecast_hour, region="ERCOT"
    )

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


# ── Internal helpers ────────────────────────────────────────────────


async def _get_city_temps(
    scenario: str,
    forecast_hour: int,
) -> Dict[str, float]:
    """Fetch city temps from weather service, falling back to hardcoded values."""
    start_time_str = SCENARIO_START_TIMES.get(scenario)
    city_forecasts = None

    if start_time_str and weather_service.model_loaded:
        try:
            dt = datetime.fromisoformat(start_time_str).replace(tzinfo=timezone.utc)
            city_forecasts = await weather_service.get_city_forecasts(dt)
        except Exception as exc:
            logger.warning("Weather service unavailable, using fallback: %s", exc)

    return demand_service.get_city_temps_for_hour(city_forecasts, forecast_hour)
