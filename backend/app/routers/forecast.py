"""Price forecast endpoints — wholesale + retail price predictions."""

from typing import Optional

from fastapi import APIRouter, Query

from app.models.price import ModelInfoResponse, PriceForecastResponse, PricingMode
from app.schemas.responses import SuccessResponse
from app.services.price_service import price_service

router = APIRouter(prefix="/api/forecast", tags=["forecast"])


@router.get("/prices/model-info", response_model=SuccessResponse[ModelInfoResponse])
async def price_model_info() -> SuccessResponse[ModelInfoResponse]:
    """XGBoost model status — training date, R² score, feature list."""
    data = price_service.get_model_info()
    return SuccessResponse(data=ModelInfoResponse(**data))


@router.get("/prices/{region}", response_model=SuccessResponse[PriceForecastResponse])
async def price_forecast_by_region(
    region: str,
    mode: PricingMode = Query(default=PricingMode.HYBRID, examples=["hybrid"]),
    scenario: str = Query(default="normal", examples=["uri_2021"]),
    zone: Optional[str] = Query(default=None, description="ERCOT weather zone for zone-adjusted pricing"),
) -> SuccessResponse[PriceForecastResponse]:
    """48-hour price forecast for a specific ISO region, optionally zone-adjusted."""
    from datetime import datetime, timezone

    if zone:
        prices = price_service.get_zone_price_forecast(
            region=region.upper(), zone=zone, mode=mode, scenario=scenario,
        )
    else:
        prices = price_service.get_price_forecast(
            region=region.upper(), mode=mode, scenario=scenario,
        )
    return SuccessResponse(data=PriceForecastResponse(
        region=region.upper(),
        start_time=datetime.now(timezone.utc),
        mode=mode if price_service.model is not None or mode == PricingMode.RULES else PricingMode.RULES,
        prices=prices,
    ))


@router.get("/prices", response_model=SuccessResponse[PriceForecastResponse])
async def price_forecast(
    region: str = Query(default="ERCOT", examples=["ERCOT"]),
    mode: PricingMode = Query(default=PricingMode.HYBRID, examples=["hybrid"]),
    scenario: str = Query(default="normal", examples=["uri_2021"]),
    zone: Optional[str] = Query(default=None, description="ERCOT weather zone for zone-adjusted pricing"),
) -> SuccessResponse[PriceForecastResponse]:
    """48-hour wholesale + retail electricity price forecast by ISO region."""
    from datetime import datetime, timezone

    if zone:
        prices = price_service.get_zone_price_forecast(
            region=region.upper(), zone=zone, mode=mode, scenario=scenario,
        )
    else:
        prices = price_service.get_price_forecast(
            region=region.upper(), mode=mode, scenario=scenario,
        )
    return SuccessResponse(data=PriceForecastResponse(
        region=region.upper(),
        start_time=datetime.now(timezone.utc),
        mode=mode if price_service.model is not None or mode == PricingMode.RULES else PricingMode.RULES,
        prices=prices,
    ))
