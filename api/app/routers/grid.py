from fastapi import APIRouter

from app.models.grid import GridStatusResponse
from app.schemas.responses import SuccessResponse
from app.services import grid_service

router = APIRouter(prefix="/api/grid", tags=["grid"])


@router.get("/status", response_model=SuccessResponse[GridStatusResponse])
async def grid_status() -> SuccessResponse[GridStatusResponse]:
    """Current grid stress levels across all major ISO regions nationally."""
    data = await grid_service.get_grid_status()
    return SuccessResponse(data=data)
