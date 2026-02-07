"""Cascade Simulation Engine.

Takes a NetworkX graph and per-node demand multipliers, then iteratively
models failure propagation:

1. Apply demand multipliers → compute current load per node.
2. Find overloaded nodes (load > 105% capacity, accounting for safety margins).
3. Mark them failed; redistribute 70% of each failed node's load
   equally to its non-failed neighbours.
4. Repeat until no new failures or 20 iterations.

Returns step-by-step failure progression for frontend animation.
"""

from __future__ import annotations

import copy
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Set

import networkx as nx

logger = logging.getLogger("blackout.cascade")

MAX_CASCADE_ITERATIONS = 20
REDISTRIBUTION_FACTOR = 0.70
# Realistic failure threshold: nodes can briefly operate above nameplate capacity
# Grid equipment typically has 5-10% safety margin before tripping
FAILURE_THRESHOLD = 1.05  # Node fails at 105% of capacity, not 100%

# Cold weather infrastructure failure simulation (for Uri scenario)
# Temperatures and failure rates calibrated to match actual Uri (70% generation offline)
EXTREME_COLD_THRESHOLD = 20.0  # °F - Severe equipment failures
COLD_THRESHOLD = 32.0  # °F - Moderate equipment stress
EXTREME_COLD_FAILURE_RATE = 0.40  # 40% of nodes fail at <20°F (gas plants, frozen lines)
COLD_FAILURE_RATE = 0.15  # 15% of nodes fail at 20-32°F (equipment stress, icing)


def run_cascade(
    graph: nx.Graph,
    demand_multipliers: Dict[str, float],
    scenario_label: str = "uri_2021",
    forecast_hour: int = 36,
    weather_by_zone: Dict[str, Dict[str, float]] | None = None,
) -> Dict[str, Any]:
    """Execute the cascade simulation and return a full result dict.

    Parameters
    ----------
    graph : nx.Graph
        The base grid graph (will be deep-copied — never mutated).
    demand_multipliers : dict
        Node ID → demand multiplier (e.g. 2.5 means 250 % of base load).
    scenario_label : str
        Label for the scenario (for the response envelope).
    forecast_hour : int
        Hour offset (for the response envelope).
    weather_by_zone : dict, optional
        Weather data by zone: {zone_name: {"temp_f": float, ...}}.
        Used to simulate cold-weather infrastructure failures (Uri scenario).
    """
    started = datetime.now(timezone.utc)
    g = copy.deepcopy(graph)

    logger.info(
        f"Starting cascade simulation: scenario={scenario_label}, "
        f"forecast_hour={forecast_hour}, nodes={g.number_of_nodes()}, "
        f"weather_zones={len(weather_by_zone) if weather_by_zone else 0}"
    )

    # ── Step 0: Apply demand multipliers ────────────────────────────
    for nid in g.nodes:
        mult = demand_multipliers.get(nid, 1.0)
        g.nodes[nid]["current_load"] = g.nodes[nid]["base_load_mw"] * mult

    failed: Set[str] = set()
    steps: List[Dict[str, Any]] = []

    # ── Step 0.5: Simulate cold-weather infrastructure failures ─────
    # During extreme cold (Uri scenario), equipment freezes, gas plants trip,
    # transmission lines ice over, etc. This pre-fails nodes BEFORE cascade.
    cold_weather_failures: List[str] = []
    if weather_by_zone:
        import random
        random.seed(42)  # Deterministic failures for same scenario

        for nid in list(g.nodes):
            zone = g.nodes[nid].get("weather_zone", "")
            weather = weather_by_zone.get(zone)
            if not weather:
                continue

            temp_f = weather.get("temp_f", 70.0)

            # Determine failure probability based on temperature
            failure_prob = 0.0
            if temp_f < EXTREME_COLD_THRESHOLD:
                # <20°F: Catastrophic failures (frozen gas plants, equipment)
                failure_prob = EXTREME_COLD_FAILURE_RATE
            elif temp_f < COLD_THRESHOLD:
                # 20-32°F: Moderate failures (some equipment stress)
                failure_prob = COLD_FAILURE_RATE

            # Randomly fail nodes based on probability
            # Higher capacity nodes more likely to be generation (more vulnerable)
            if failure_prob > 0:
                capacity = g.nodes[nid]["capacity_mw"]
                # Generation nodes (high capacity) 2x more likely to fail
                if capacity > 500:  # Likely a generation node
                    failure_prob *= 2.0

                if random.random() < failure_prob:
                    cold_weather_failures.append(nid)
                    failed.add(nid)
                    # Set load to 0 for failed nodes
                    g.nodes[nid]["current_load"] = 0

        if cold_weather_failures:
            # Record initial weather-driven failures as step -1 (pre-cascade)
            steps.append({
                "step": -1,  # Pre-cascade step
                "new_failures": [
                    {
                        "id": nid,
                        "lat": g.nodes[nid]["lat"],
                        "lon": g.nodes[nid]["lon"],
                        "load_mw": 0.0,  # Cold-weather failures have load set to 0
                        "capacity_mw": round(g.nodes[nid]["capacity_mw"], 1),
                    }
                    for nid in cold_weather_failures
                ],
                "reroutes": [],
                "total_failed": len(failed),
                "total_load_shed_mw": 0.0,  # No load shed yet, just failures
            })
            logger.info(
                f"Cold-weather pre-failures: {len(cold_weather_failures)} nodes failed "
                f"({len(cold_weather_failures)/g.number_of_nodes()*100:.1f}% of grid)"
            )
        else:
            logger.info("No cold-weather failures (weather_by_zone not provided or no extreme cold)")

    # ── Iterative cascade ───────────────────────────────────────────
    for iteration in range(MAX_CASCADE_ITERATIONS):
        new_failures: List[str] = []

        for nid in g.nodes:
            if nid in failed:
                continue
            # Apply failure threshold: nodes must exceed 105% capacity to fail
            # This accounts for safety margins in real grid equipment
            if g.nodes[nid]["current_load"] > g.nodes[nid]["capacity_mw"] * FAILURE_THRESHOLD:
                new_failures.append(nid)

        if not new_failures:
            break

        failed.update(new_failures)

        # Log iteration progress
        logger.info(
            f"Cascade iteration {iteration}: {len(new_failures)} new failures, "
            f"{len(failed)} total failed ({len(failed)/g.number_of_nodes()*100:.1f}% of grid)"
        )

        # Redistribute load from newly failed nodes and track reroutes.
        reroutes: List[Dict[str, Any]] = []
        for nid in new_failures:
            load_to_shed = g.nodes[nid]["current_load"] * REDISTRIBUTION_FACTOR
            alive_neighbours = [
                nb for nb in g.neighbors(nid) if nb not in failed
            ]
            if alive_neighbours:
                per_neighbour = load_to_shed / len(alive_neighbours)
                for nb in alive_neighbours:
                    g.nodes[nb]["current_load"] += per_neighbour
                    reroutes.append({
                        "from_id": nid,
                        "to_id": nb,
                        "from_lat": g.nodes[nid]["lat"],
                        "from_lon": g.nodes[nid]["lon"],
                        "to_lat": g.nodes[nb]["lat"],
                        "to_lon": g.nodes[nb]["lon"],
                        "load_mw": round(per_neighbour, 1),
                    })

        total_shed = sum(g.nodes[nid]["current_load"] for nid in failed)

        steps.append(
            {
                "step": iteration,
                "new_failures": [
                    {
                        "id": nid,
                        "lat": g.nodes[nid]["lat"],
                        "lon": g.nodes[nid]["lon"],
                        "load_mw": round(g.nodes[nid]["current_load"], 1),
                        "capacity_mw": round(g.nodes[nid]["capacity_mw"], 1),
                    }
                    for nid in new_failures
                ],
                "reroutes": reroutes,
                "total_failed": len(failed),
                "total_load_shed_mw": round(total_shed, 1),
            }
        )

    # ── Build final node states ─────────────────────────────────────
    final_states: Dict[str, Dict[str, Any]] = {}
    for nid in g.nodes:
        nd = g.nodes[nid]
        load = nd["current_load"]
        cap = nd["capacity_mw"]
        pct = (load / cap * 100.0) if cap > 0 else 0.0

        if nid in failed:
            status = "failed"
        elif pct > 80:
            status = "stressed"
        else:
            status = "nominal"

        final_states[nid] = {
            "status": status,
            "current_load_mw": round(load, 1),
            "capacity_mw": round(cap, 1),
            "load_pct": round(pct, 1),
        }

    total_shed = sum(
        g.nodes[nid]["current_load"] for nid in failed
    )

    completed = datetime.now(timezone.utc)
    duration_ms = (completed - started).total_seconds() * 1000

    logger.info(
        f"Cascade simulation complete: "
        f"{len(failed)}/{g.number_of_nodes()} nodes failed ({len(failed)/g.number_of_nodes()*100:.1f}%), "
        f"{len(steps)} cascade steps, "
        f"{total_shed:.0f} MW shed, "
        f"duration={duration_ms:.0f}ms"
    )

    return {
        "scenario": scenario_label,
        "forecast_hour": forecast_hour,
        "started_at": started.isoformat(),
        "completed_at": completed.isoformat(),
        "steps": steps,
        "total_failed_nodes": len(failed),
        "total_nodes": g.number_of_nodes(),
        "cascade_depth": len(steps),
        "total_load_shed_mw": round(total_shed, 1),
        "failed_node_ids": sorted(failed),
        "final_node_states": final_states,
    }
