from fastapi import APIRouter, Query

from app.models.consumer import (
    ConsumerProfile,
    ConsumerProfilesResponse,
    CreateCustomProfileRequest,
    RecommendationsResponse,
)
from app.schemas.responses import SuccessResponse
from app.services import consumer_service

router = APIRouter(prefix="/api/consumer", tags=["consumer"])


@router.get(
    "/recommendations", response_model=SuccessResponse[RecommendationsResponse]
)
async def recommendations(
    profile_id: str = Query(..., examples=["default-suburban-family"]),
    region: str = Query(..., examples=["CAISO"]),
) -> SuccessResponse[RecommendationsResponse]:
    """Personalized energy-saving recommendations for a household."""
    data = await consumer_service.get_recommendations(
        profile_id=profile_id,
        region=region,
    )
    return SuccessResponse(data=data)


@router.get("/profiles", response_model=SuccessResponse[ConsumerProfilesResponse])
async def profiles() -> SuccessResponse[ConsumerProfilesResponse]:
    """List all pre-made and user-saved consumer profiles."""
    data = await consumer_service.get_profiles()
    return SuccessResponse(data=data)


@router.post(
    "/profiles/custom",
    response_model=SuccessResponse[ConsumerProfile],
    status_code=201,
)
async def create_custom_profile(
    request: CreateCustomProfileRequest,
) -> SuccessResponse[ConsumerProfile]:
    """Create a new custom consumer profile."""
    data = await consumer_service.create_custom_profile(request=request)
    return SuccessResponse(data=data)
