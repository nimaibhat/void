"""Simulate Service — chains demand → cascade for the
POST /api/simulate/cascade endpoint.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict

from app.services import demand_service
from app.services.cascade_service import run_cascade
from app.services.grid_graph_service import grid_graph

logger = logging.getLogger("blackout.simulate_service")


async def run_cascade_simulation(
    start_time_str: str,
    forecast_hour: int,
    region: str,
) -> Dict[str, Any]:
    """Full pipeline: compute demand from ERCOT data → run cascade.

    Parameters
    ----------
    start_time_str : str
        ISO datetime for the weather scenario (e.g. "2021-02-13T00:00:00").
    forecast_hour : int
        Hour offset into the forecast (0-48).
    region : str
        ISO region (currently only ERCOT has real grid data).
    """
    # Determine scenario from start_time
    scenario = "uri" if "2021-02" in start_time_str else "normal"

    # Compute demand multipliers from real ERCOT data
    multipliers = demand_service.compute_demand_multipliers(
        scenario=scenario, forecast_hour=forecast_hour
    )

    # Run the cascade simulation on a deep copy of the grid
    result = run_cascade(
        graph=grid_graph.graph,
        demand_multipliers=multipliers,
        scenario_label=f"{region.lower()}_{start_time_str[:10].replace('-', '')}",
        forecast_hour=forecast_hour,
    )

    return result
