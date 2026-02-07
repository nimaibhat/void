"""Cascade simulation endpoint — weather → demand → cascade pipeline."""

from fastapi import APIRouter

from app.models.simulate import CascadeRequest, CascadeResult
from app.schemas.responses import SuccessResponse
from app.services import simulate_service

router = APIRouter(prefix="/api/simulate", tags=["simulate"])


@router.post("/cascade", response_model=SuccessResponse[CascadeResult])
async def cascade_simulation(
    body: CascadeRequest,
) -> SuccessResponse[CascadeResult]:
    """Run a full cascade simulation.

    Fetches weather forecast for the given start_time, computes demand
    multipliers per node, then runs iterative cascade failure propagation.
    Returns step-by-step failure progression for frontend animation.
    """
    data = await simulate_service.run_cascade_simulation(
        start_time_str=body.start_time,
        forecast_hour=body.forecast_hour,
        region=body.region,
        scenario=body.scenario,
    )
    return SuccessResponse(data=CascadeResult(**data))
