from fastapi import APIRouter

from app.models.simulate import CascadeScenario, CascadeSimulationResponse
from app.schemas.responses import SuccessResponse
from app.services import simulate_service

router = APIRouter(prefix="/api/simulate", tags=["simulate"])


@router.post("/cascade", response_model=SuccessResponse[CascadeSimulationResponse])
async def cascade_simulation(
    scenario: CascadeScenario,
) -> SuccessResponse[CascadeSimulationResponse]:
    """Run a cascade failure simulation with the given scenario parameters."""
    data = await simulate_service.run_cascade_simulation(scenario=scenario)
    return SuccessResponse(data=data)
