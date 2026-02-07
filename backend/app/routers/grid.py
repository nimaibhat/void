"""Grid endpoints — topology, status with demand, cascade probability, node detail."""

from fastapi import APIRouter, HTTPException, Query

from app.models.grid import (
    ArcsResponse,
    CascadeProbabilityResponse,
    GridStatusResponse,
    GridTopologyResponse,
    HotspotsResponse,
    NodeDetailResponse,
)
from app.schemas.responses import SuccessResponse
from app.services import grid_service, hotspot_service

router = APIRouter(prefix="/api/grid", tags=["grid"])


@router.get("/status", response_model=SuccessResponse[GridStatusResponse])
async def grid_status(
    scenario: str = Query(default="uri_2021", examples=["uri_2021"]),
    forecast_hour: int = Query(default=36, ge=0, le=48, examples=[36]),
) -> SuccessResponse[GridStatusResponse]:
    """Grid state for all nodes with demand from a weather scenario applied."""
    data = await grid_service.get_grid_status(scenario=scenario, forecast_hour=forecast_hour)
    return SuccessResponse(data=GridStatusResponse(**data))


@router.get("/topology", response_model=SuccessResponse[GridTopologyResponse])
async def grid_topology() -> SuccessResponse[GridTopologyResponse]:
    """Raw grid graph — nodes with lat/lon/capacity, edges with connections.

    Used by the frontend globe to plot substation locations.
    """
    data = grid_service.get_topology()
    return SuccessResponse(data=GridTopologyResponse(**data))


@router.get(
    "/cascade-probability",
    response_model=SuccessResponse[CascadeProbabilityResponse],
)
async def cascade_probability(
    scenario: str = Query(default="uri_2021", examples=["uri_2021"]),
    forecast_hour: int = Query(default=36, ge=0, le=48, examples=[36]),
) -> SuccessResponse[CascadeProbabilityResponse]:
    """Cascade probability per ISO region (fraction of nodes above 80 % load)."""
    data = await grid_service.get_cascade_probability(
        scenario=scenario, forecast_hour=forecast_hour
    )
    return SuccessResponse(data=CascadeProbabilityResponse(**data))


@router.get("/nodes/{node_id}", response_model=SuccessResponse[NodeDetailResponse])
async def node_detail(node_id: str) -> SuccessResponse[NodeDetailResponse]:
    """Detailed info for a single grid node."""
    data = grid_service.get_node_detail(node_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Node not found: {node_id}")
    return SuccessResponse(data=NodeDetailResponse(**data))


@router.get("/hotspots", response_model=SuccessResponse[HotspotsResponse])
async def hotspots(
    scenario: str = Query(default="uri", examples=["uri", "normal"]),
) -> SuccessResponse[HotspotsResponse]:
    """City-level severity markers for the operator globe."""
    data = hotspot_service.get_hotspots(scenario=scenario)
    return SuccessResponse(data=data)


@router.get("/arcs", response_model=SuccessResponse[ArcsResponse])
async def arcs(
    scenario: str = Query(default="uri", examples=["uri", "normal"]),
) -> SuccessResponse[ArcsResponse]:
    """Transmission lines between hotspot cities."""
    data = hotspot_service.get_arcs(scenario=scenario)
    return SuccessResponse(data=data)
