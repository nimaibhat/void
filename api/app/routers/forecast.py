from typing import Optional

from fastapi import APIRouter, Query

from app.models.forecast import (
    ISORegion,
    PriceForecastResponse,
    WeatherForecastResponse,
)
from app.schemas.responses import SuccessResponse
from app.services import forecast_service

router = APIRouter(prefix="/api/forecast", tags=["forecast"])


@router.get("/weather", response_model=SuccessResponse[WeatherForecastResponse])
async def weather_forecast(
    latitude: float = Query(..., ge=-90, le=90, examples=[37.7749]),
    longitude: float = Query(..., ge=-180, le=180, examples=[-122.4194]),
    hours_ahead: int = Query(default=24, ge=1, le=168, examples=[48]),
) -> SuccessResponse[WeatherForecastResponse]:
    """Earth-2 weather prediction for a geographic region."""
    data = await forecast_service.get_weather_forecast(
        latitude=latitude,
        longitude=longitude,
        hours_ahead=hours_ahead,
    )
    return SuccessResponse(data=data)


@router.get("/prices", response_model=SuccessResponse[PriceForecastResponse])
async def price_forecast(
    iso: ISORegion = Query(..., examples=["CAISO"]),
    hours_ahead: int = Query(default=24, ge=1, le=168, examples=[24]),
    node_id: Optional[str] = Query(default=None, examples=["LAPLMG1_7_B2"]),
) -> SuccessResponse[PriceForecastResponse]:
    """Wholesale electricity price forecast by ISO region."""
    data = await forecast_service.get_price_forecast(
        iso=iso,
        hours_ahead=hours_ahead,
        node_id=node_id,
    )
    return SuccessResponse(data=data)
