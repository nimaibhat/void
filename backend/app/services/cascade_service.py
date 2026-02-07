"""Cascade Simulation Engine.

Takes a NetworkX graph and per-node demand multipliers, then iteratively
models failure propagation:

1. Apply demand multipliers → compute current load per node.
2. Find overloaded nodes (load > capacity).
3. Mark them failed; redistribute 70 % of each failed node's load
   equally to its non-failed neighbours.
4. Repeat until no new failures or 20 iterations.

Returns step-by-step failure progression for frontend animation.
"""

from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any, Dict, List, Set

import networkx as nx

MAX_CASCADE_ITERATIONS = 20
REDISTRIBUTION_FACTOR = 0.70


def run_cascade(
    graph: nx.Graph,
    demand_multipliers: Dict[str, float],
    scenario_label: str = "uri_2021",
    forecast_hour: int = 36,
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
    """
    started = datetime.now(timezone.utc)
    g = copy.deepcopy(graph)

    # ── Step 0: Apply demand multipliers ────────────────────────────
    for nid in g.nodes:
        mult = demand_multipliers.get(nid, 1.0)
        g.nodes[nid]["current_load"] = g.nodes[nid]["base_load_mw"] * mult

    failed: Set[str] = set()
    steps: List[Dict[str, Any]] = []

    # ── Iterative cascade ───────────────────────────────────────────
    for iteration in range(MAX_CASCADE_ITERATIONS):
        new_failures: List[str] = []

        for nid in g.nodes:
            if nid in failed:
                continue
            if g.nodes[nid]["current_load"] > g.nodes[nid]["capacity_mw"]:
                new_failures.append(nid)

        if not new_failures:
            break

        failed.update(new_failures)

        # Redistribute load from newly failed nodes.
        for nid in new_failures:
            load_to_shed = g.nodes[nid]["current_load"] * REDISTRIBUTION_FACTOR
            alive_neighbours = [
                nb for nb in g.neighbors(nid) if nb not in failed
            ]
            if alive_neighbours:
                per_neighbour = load_to_shed / len(alive_neighbours)
                for nb in alive_neighbours:
                    g.nodes[nb]["current_load"] += per_neighbour

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
