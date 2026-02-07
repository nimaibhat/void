from fastapi import APIRouter, Query

from app.models.utility import CrewOptimizationResponse
from app.schemas.responses import SuccessResponse
from app.services import utility_service

router = APIRouter(prefix="/api/utility", tags=["utility"])


@router.get(
    "/crew-optimization", response_model=SuccessResponse[CrewOptimizationResponse]
)
async def crew_optimization(
    region: str = Query(..., examples=["CAISO"]),
) -> SuccessResponse[CrewOptimizationResponse]:
    """Optimal crew positioning and assignment for a given region."""
    data = await utility_service.get_crew_optimization(region=region)
    return SuccessResponse(data=data)
