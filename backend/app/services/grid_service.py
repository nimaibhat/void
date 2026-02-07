"""Grid Service — orchestrates grid graph and demand data to produce
grid-status, topology, and cascade-probability responses.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

from app.services import demand_service, overview_service
from app.services.cascade_service import run_cascade
from app.services.grid_graph_service import grid_graph

logger = logging.getLogger("blackout.grid_service")

DEFAULT_FORECAST_HOUR = 36

# Cache for cascade results: (scenario, forecast_hour) -> cascade_result
_cascade_cache: Dict[Tuple[str, int], Dict[str, Any]] = {}


def prewarm_cascade_cache() -> None:
    """Pre-compute cascade probabilities for common scenarios on startup.

    This makes the first API calls instant instead of waiting 1-2s for simulation.
    Runs in background, doesn't block startup.
    """
    import asyncio

    async def _prewarm():
        logger.info("Pre-warming cascade probability cache...")
        scenarios_to_cache = [
            ("uri", 36),      # Uri peak crisis
            ("normal", 12),   # Normal midday
            ("live", 36),     # Live forecast
        ]
        for scenario, hour in scenarios_to_cache:
            try:
                await get_cascade_probability(scenario, hour)
            except Exception as e:
                logger.warning(f"Failed to prewarm {scenario} h={hour}: {e}")
        logger.info(f"Cascade cache pre-warmed with {len(_cascade_cache)} entries")

    # Run async in background (don't await)
    asyncio.create_task(_prewarm())


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
    """Cascade probability from REAL cascade simulation (cached).

    Runs the actual cascade simulation to get the TRUE failure rate,
    not a heuristic estimate. Results are cached per (scenario, forecast_hour).
    """
    cache_key = (scenario, forecast_hour)

    # Check cache first
    if cache_key in _cascade_cache:
        cached = _cascade_cache[cache_key]
        ercot_prob = cached["total_failed_nodes"] / max(cached["total_nodes"], 1)
        logger.debug(
            f"Cascade probability (cached): {ercot_prob:.1%} "
            f"({cached['total_failed_nodes']}/{cached['total_nodes']} nodes failed)"
        )
    else:
        # Run actual cascade simulation
        logger.info(f"Running cascade simulation for {scenario} h={forecast_hour} (not cached)")
        multipliers = demand_service.compute_demand_multipliers(scenario, forecast_hour)

        # Get weather data for cold-weather failure simulation (Uri scenario)
        weather_by_zone = None
        if scenario in ("uri", "uri_2021"):
            overview = overview_service.get_overview(scenario)
            weather_by_zone = {
                r.name: {
                    "temp_f": r.weather.temp_f,
                    "wind_mph": r.weather.wind_mph,
                    "is_extreme": r.weather.is_extreme,
                }
                for r in overview.regions
            }

        cascade_result = run_cascade(
            graph=grid_graph.graph,
            demand_multipliers=multipliers,
            scenario_label=f"{scenario}_cascade_prob",
            forecast_hour=forecast_hour,
            weather_by_zone=weather_by_zone,
        )

        # Cache the result
        _cascade_cache[cache_key] = cascade_result

        # Calculate actual failure rate
        ercot_prob = cascade_result["total_failed_nodes"] / max(cascade_result["total_nodes"], 1)
        logger.info(
            f"Cascade simulation complete: {ercot_prob:.1%} failure rate "
            f"({cascade_result['total_failed_nodes']}/{cascade_result['total_nodes']} nodes, "
            f"{cascade_result['cascade_depth']} steps, "
            f"{cascade_result['total_load_shed_mw']:.0f} MW shed)"
        )

    return {
        "probabilities": {
            "ERCOT": round(ercot_prob, 3),
            # Other ISOs remain placeholders (no real grid data)
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
