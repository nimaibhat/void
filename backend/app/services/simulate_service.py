"""Simulate Service — chains weather → demand → cascade for the
POST /api/simulate/cascade endpoint.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict

from app.services import demand_service
from app.services.cascade_service import run_cascade
from app.services.grid_graph_service import grid_graph
from app.services.weather_service import weather_service

logger = logging.getLogger("blackout.simulate_service")


async def run_cascade_simulation(
    start_time_str: str,
    forecast_hour: int,
    region: str,
) -> Dict[str, Any]:
    """Full pipeline: fetch weather → compute demand → run cascade.

    Parameters
    ----------
    start_time_str : str
        ISO datetime for the weather scenario (e.g. "2021-02-13T00:00:00").
    forecast_hour : int
        Hour offset into the forecast (0-48).
    region : str
        ISO region (currently only ERCOT has real grid data).
    """
    # 1. Fetch city temperatures from the weather service.
    city_forecasts = None
    if weather_service.model_loaded:
        try:
            dt = datetime.fromisoformat(start_time_str).replace(tzinfo=timezone.utc)
            city_forecasts = await weather_service.get_city_forecasts(dt)
        except Exception as exc:
            logger.warning("Weather fetch failed, using fallback temps: %s", exc)

    city_temps = demand_service.get_city_temps_for_hour(city_forecasts, forecast_hour)

    # 2. Compute demand multipliers for every grid node.
    multipliers = demand_service.compute_demand_multipliers(
        city_temps, forecast_hour, region=region
    )

    # 3. Run the cascade simulation on a deep copy of the grid.
    result = run_cascade(
        graph=grid_graph.graph,
        demand_multipliers=multipliers,
        scenario_label=f"{region.lower()}_{start_time_str[:10].replace('-', '')}",
        forecast_hour=forecast_hour,
    )

    return result
