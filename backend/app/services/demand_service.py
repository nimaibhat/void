"""Demand Service — distributes real ERCOT zone-level load data
proportionally across buses by their base Pd values.

Uses actual ERCOT load data from the Native_Load_2021.xlsx file.
For Uri scenarios, applies a demand uplift factor because the ERCOT data
reflects *served* load (post-curtailment), not the true *demanded* load.
ERCOT estimated ~76 GW demand during Uri peak but could only serve ~46 GW.
"""

from __future__ import annotations

import logging
from typing import Dict

from app.services.ercot_data_service import ercot_data
from app.services.grid_graph_service import grid_graph

logger = logging.getLogger("blackout.demand")

# ── Time-of-day load curve (hour → multiplier) ─────────────────────
# Kept here because price_service imports it for price modeling.

TOD_CURVE: Dict[int, float] = {
    0: 0.65, 1: 0.60, 2: 0.58, 3: 0.57, 4: 0.57, 5: 0.60,
    6: 0.70, 7: 0.80, 8: 0.90, 9: 0.95, 10: 0.98, 11: 1.00,
    12: 1.02, 13: 1.03, 14: 1.05, 15: 1.05, 16: 1.08, 17: 1.10,
    18: 1.15, 19: 1.15, 20: 1.12, 21: 1.05, 22: 0.90, 23: 0.78,
}

# During Uri, actual demand was ~65% higher than served load due to forced
# load shedding. This factor restores the uncurtailed demand estimate.
URI_DEMAND_UPLIFT = 1.65


def compute_demand_multipliers(
    scenario: str = "uri",
    forecast_hour: int = 36,
) -> Dict[str, float]:
    """Compute demand multiplier for every node in the grid using real ERCOT data.

    For each bus:
      1. Get the bus's ERCOT weather zone
      2. Get total base_load_mw for all buses in that zone (sum of Pd values)
      3. Get actual zone load from ERCOT data (uplifted for Uri)
      4. Multiplier = zone_demand / total_zone_base_load

    This distributes real zone-level load proportionally across buses.
    """
    zone_loads = ercot_data.get_scenario_loads(scenario, forecast_hour)

    if not zone_loads:
        logger.warning("No ERCOT load data for scenario=%s hour=%d, using defaults", scenario, forecast_hour)
        if scenario in ("uri", "uri_2021"):
            return {nid: 2.5 for nid in grid_graph.get_node_ids()}
        return {nid: 1.0 for nid in grid_graph.get_node_ids()}

    # For Uri: uplift served load to estimate true demand
    uplift = URI_DEMAND_UPLIFT if scenario in ("uri", "uri_2021") else 1.0

    # Compute total base load per weather zone
    zone_base_totals: Dict[str, float] = {}
    for zone_name in grid_graph.get_weather_zones():
        total = 0.0
        for nid in grid_graph.get_nodes_in_weather_zone(zone_name):
            total += grid_graph.graph.nodes[nid]["base_load_mw"]
        zone_base_totals[zone_name] = total

    # Compute per-node multipliers
    multipliers: Dict[str, float] = {}
    for nid in grid_graph.get_node_ids():
        nd = grid_graph.graph.nodes[nid]
        wz = nd["weather_zone"]
        base_total = zone_base_totals.get(wz, 0.0)
        actual_load = zone_loads.get(wz, 0.0) * uplift

        if base_total > 0 and actual_load > 0:
            multiplier = actual_load / base_total
        else:
            multiplier = 1.0

        multipliers[nid] = round(multiplier, 4)

    return multipliers
