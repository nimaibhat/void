"""Consumer endpoints — optimization recommendations, savings, profiles."""

from fastapi import APIRouter, Query

from app.models.consumer import (
    ConsumerProfile,
    ConsumerProfilesResponse,
    ConsumerRecommendation,
    CreateCustomProfileRequest,
    SavingsSummary,
)
from app.schemas.responses import SuccessResponse
from app.services import consumer_service

router = APIRouter(prefix="/api/consumer", tags=["consumer"])


@router.get(
    "/recommendations/{profile_id}",
    response_model=SuccessResponse[ConsumerRecommendation],
)
async def recommendations(
    profile_id: str,
    region: str = Query(default="ERCOT", examples=["ERCOT"]),
    scenario: str = Query(default="normal", examples=["uri_2021"]),
) -> SuccessResponse[ConsumerRecommendation]:
    """Optimized appliance schedule, battery/solar savings, readiness score."""
    data = await consumer_service.get_recommendations(
        profile_id=profile_id, region=region, scenario=scenario,
    )
    return SuccessResponse(data=data)


@router.get(
    "/savings/{profile_id}",
    response_model=SuccessResponse[SavingsSummary],
)
async def savings(
    profile_id: str,
    region: str = Query(default="ERCOT", examples=["ERCOT"]),
    scenario: str = Query(default="normal", examples=["uri_2021"]),
) -> SuccessResponse[SavingsSummary]:
    """Savings summary — total dollars/kWh saved, readiness, status."""
    data = await consumer_service.get_savings(
        profile_id=profile_id, region=region, scenario=scenario,
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
