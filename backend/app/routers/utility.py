"""Utility operator endpoints — overview, crews, events, outcomes."""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.models.utility import (
    CrewOptimizationResponse,
    NationalOverview,
    OutcomeComparison,
    RegionOverview,
    TimelineEvent,
)
from app.schemas.responses import SuccessResponse
from app.services import events_service, outcome_service, overview_service, utility_service

router = APIRouter(prefix="/api/utility", tags=["utility"])


@router.get("/overview", response_model=SuccessResponse[NationalOverview])
async def overview(
    scenario: str = Query(default="uri", examples=["uri", "normal"]),
) -> SuccessResponse[NationalOverview]:
    """National grid overview with per-region status."""
    data = overview_service.get_overview(scenario=scenario)
    return SuccessResponse(data=data)


@router.get("/overview/{region}", response_model=SuccessResponse[RegionOverview])
async def region_detail(
    region: str,
    scenario: str = Query(default="uri", examples=["uri", "normal"]),
) -> SuccessResponse[RegionOverview]:
    """Single region detail."""
    data = overview_service.get_region(region_id=region, scenario=scenario)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Region not found: {region}")
    return SuccessResponse(data=data)


@router.get("/crews", response_model=SuccessResponse[CrewOptimizationResponse])
async def crews(
    scenario: str = Query(default="uri", examples=["uri", "normal"]),
) -> SuccessResponse[CrewOptimizationResponse]:
    """Optimized crew assignments."""
    data = utility_service.get_crews(scenario=scenario)
    return SuccessResponse(data=data)


@router.get("/events", response_model=SuccessResponse[list[TimelineEvent]])
async def events(
    scenario: str = Query(default="uri", examples=["uri", "normal"]),
) -> SuccessResponse[list[TimelineEvent]]:
    """Pre-generated timeline events."""
    data = events_service.get_events(scenario=scenario)
    return SuccessResponse(data=data)


@router.get("/events/stream")
async def events_stream(
    scenario: str = Query(default="uri", examples=["uri", "normal"]),
) -> StreamingResponse:
    """SSE live event stream (2-3s intervals)."""
    return StreamingResponse(
        events_service.stream_events(scenario=scenario),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@router.get("/outcomes", response_model=SuccessResponse[OutcomeComparison])
async def outcomes(
    scenario: str = Query(default="uri", examples=["uri", "normal"]),
) -> SuccessResponse[OutcomeComparison]:
    """Without/With Blackout comparison."""
    data = outcome_service.get_outcomes(scenario=scenario)
    return SuccessResponse(data=data)
