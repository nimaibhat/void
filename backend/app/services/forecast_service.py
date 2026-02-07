from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.models.forecast import (
    HourlyPrice,
    HourlyWeather,
    ISORegion,
    PriceForecastResponse,
    WeatherForecastResponse,
)


async def get_weather_forecast(
    latitude: float,
    longitude: float,
    hours_ahead: int,
) -> WeatherForecastResponse:
    """Fetch weather forecast from Earth-2 model for a given location.

    This should call the NVIDIA Earth-2 API (or equivalent weather model)
    to produce high-resolution weather predictions for the target coordinates.

    Args:
        latitude: Target latitude (-90 to 90).
        longitude: Target longitude (-180 to 180).
        hours_ahead: Number of hours to forecast (1-168).

    Returns:
        WeatherForecastResponse with hourly weather data.
    """
    # TODO: Implement actual Earth-2 API integration here
    now = datetime.now(timezone.utc)
    hourly = [
        HourlyWeather(
            timestamp=now + timedelta(hours=i),
            temperature_f=85.0 + (i % 12) - 6,
            humidity_pct=45.0 + (i % 10),
            wind_speed_mph=8.0 + (i % 5),
            cloud_cover_pct=20.0 + (i % 30),
            precipitation_in=0.0,
        )
        for i in range(hours_ahead)
    ]
    return WeatherForecastResponse(
        latitude=latitude,
        longitude=longitude,
        model="earth2-fourcastnet",
        generated_at=now,
        hourly=hourly,
    )


async def get_price_forecast(
    iso: ISORegion,
    hours_ahead: int,
    node_id: str | None,
) -> PriceForecastResponse:
    """Fetch wholesale electricity price forecast for an ISO region.

    This should pull real-time LMP data and run a price forecasting model
    based on historical patterns, weather, and demand signals.

    Args:
        iso: ISO/RTO region identifier.
        hours_ahead: Number of hours to forecast (1-168).
        node_id: Optional specific pricing node within the ISO.

    Returns:
        PriceForecastResponse with hourly price data.
    """
    # TODO: Implement actual price forecasting logic here
    now = datetime.now(timezone.utc)
    hourly = [
        HourlyPrice(
            timestamp=now + timedelta(hours=i),
            lmp_dollar_per_mwh=35.0 + (i % 24) * 2.5,
            congestion_dollar_per_mwh=2.0 + (i % 8),
            loss_dollar_per_mwh=1.0 + (i % 3) * 0.5,
        )
        for i in range(hours_ahead)
    ]
    return PriceForecastResponse(
        iso=iso,
        node_id=node_id,
        generated_at=now,
        hourly=hourly,
    )
