"""Outcome Service — compares Without vs With Blackout scenarios for the command bar."""

from __future__ import annotations

from typing import Any, Dict, Set

from app.models.utility import OutcomeComparison, ScenarioOutcome
from app.services import demand_service
from app.services.cascade_service import run_cascade
from app.services.grid_graph_service import grid_graph

# Customers per MW of lost capacity
_CUSTOMERS_PER_MW = 500

# Baseline price (normal conditions)
_NORMAL_PRICE_MWH = 35.0

# Uri peak price without mitigation
_URI_PEAK_PRICE_MWH = 9000.0


def _count_affected_zones(failed_ids: list[str]) -> int:
    """Count distinct weather zones among failed nodes."""
    zones: Set[str] = set()
    for nid in failed_ids:
        if nid in grid_graph.graph.nodes:
            zones.add(grid_graph.graph.nodes[nid]["weather_zone"])
    return len(zones)


def get_outcomes(scenario: str = "uri") -> OutcomeComparison:
    """Run cascade with and without Blackout optimization, compare results."""

    # ── Without Blackout: full demand, no mitigation ─────────────────
    multipliers_raw = demand_service.compute_demand_multipliers(
        scenario=scenario, forecast_hour=36
    )

    result_without = run_cascade(
        graph=grid_graph.graph,
        demand_multipliers=multipliers_raw,
        scenario_label=f"{scenario}_no_mitigation",
        forecast_hour=36,
    )

    failed_without = result_without["total_failed_nodes"]
    shed_without = result_without["total_load_shed_mw"]
    customers_without = int(shed_without * _CUSTOMERS_PER_MW)
    regions_without = _count_affected_zones(result_without["failed_node_ids"])
    steps_without = result_without["cascade_depth"]

    # ── With Blackout: 12% demand reduction + crew repair factor ────
    multipliers_mitigated = {
        nid: mult * 0.88 for nid, mult in multipliers_raw.items()
    }

    result_with = run_cascade(
        graph=grid_graph.graph,
        demand_multipliers=multipliers_mitigated,
        scenario_label=f"{scenario}_with_blackout",
        forecast_hour=36,
    )

    failed_with = result_with["total_failed_nodes"]
    shed_with = result_with["total_load_shed_mw"]
    customers_with = int(shed_with * _CUSTOMERS_PER_MW)
    regions_with = _count_affected_zones(result_with["failed_node_ids"])
    steps_with = result_with["cascade_depth"]

    # ── Price impact ────────────────────────────────────────────────
    # Uri: $9000 peak without, 55% reduction with mitigation
    # Normal/Live: use proportional to failure ratio
    if scenario == "uri":
        price_without = _URI_PEAK_PRICE_MWH
        price_with = round(_URI_PEAK_PRICE_MWH * 0.55, 2)
    else:
        # Scale from normal price based on failure severity
        failure_ratio = failed_without / max(result_without["total_nodes"], 1)
        price_without = round(_NORMAL_PRICE_MWH * (1 + failure_ratio * 50), 2)
        price_with = round(price_without * (failed_with / max(failed_without, 1)), 2)

    # ── Blackout duration ───────────────────────────────────────────
    duration_without = 48.0
    duration_with = max(0, duration_without * (failed_with / max(failed_without, 1)))

    # ── Build comparison ────────────────────────────────────────────
    without = ScenarioOutcome(
        scenario_name="Without Blackout",
        total_affected_customers=customers_without,
        peak_price_mwh=price_without,
        blackout_duration_hours=duration_without,
        regions_affected=regions_without,
        cascade_steps=steps_without,
        failed_nodes=failed_without,
    )

    with_bo = ScenarioOutcome(
        scenario_name="With Blackout",
        total_affected_customers=customers_with,
        peak_price_mwh=price_with,
        blackout_duration_hours=round(duration_with, 1),
        regions_affected=regions_with,
        cascade_steps=steps_with,
        failed_nodes=failed_with,
    )

    customers_saved = max(0, customers_without - customers_with)
    price_reduction = round(
        (1 - price_with / price_without) * 100, 1
    ) if price_without > 0 else 0.0
    cascade_reduction = round(
        (1 - steps_with / max(steps_without, 1)) * 100, 1
    )

    return OutcomeComparison(
        without_blackout=without,
        with_blackout=with_bo,
        customers_saved=customers_saved,
        price_reduction_pct=price_reduction,
        cascade_reduction_pct=cascade_reduction,
    )
