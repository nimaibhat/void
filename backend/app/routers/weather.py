"""SFNO weather forecast endpoints.

All routes are mounted under ``/api/forecast/weather`` by the main app.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Path, Query
from fastapi.responses import JSONResponse

from app.models.weather import (
    CitiesForecastResponse,
    CityForecast,
    GridTimestep,
    SFNOGridForecast,
    WeatherRunRequest,
    WeatherStatusResponse,
)
from app.schemas.responses import ErrorResponse, SuccessResponse
from app.services.weather_service import (
    DataFetchError,
    GPUOutOfMemoryError,
    ModelNotLoadedError,
    resolve_city_name,
    weather_service,
)

router = APIRouter(prefix="/api/forecast/weather", tags=["weather"])


def _parse_start_time(raw: str) -> datetime:
    """Parse an ISO-format start_time string into a tz-aware datetime."""
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


# ── GET /api/forecast/weather ───────────────────────────────────────


@router.get("", response_model=SuccessResponse[SFNOGridForecast])
async def grid_forecast(
    start_time: str = Query(
        default="2021-02-13T00:00:00",
        examples=["2021-02-13T00:00:00"],
        description="ISO datetime for forecast start",
    ),
    region: str = Query(
        default="us",
        description="Region to extract (currently only 'us')",
    ),
) -> SuccessResponse[SFNOGridForecast] | JSONResponse:
    """SFNO grid forecast — 9 timesteps of 2D temperature, wind, pressure grids.

    Checks disk cache first; runs GPU inference only if not cached.
    """
    try:
        dt = _parse_start_time(start_time)
        data = await weather_service.get_forecast(dt, region=region)
        # Build typed response (GridTimestep ignores extra fields like wind_dir_deg).
        steps = [GridTimestep(**s) for s in data["steps"]]
        payload = SFNOGridForecast(
            start_time=data["start_time"],
            region=data["region"],
            generated_at=data["generated_at"],
            steps=steps,
        )
        return SuccessResponse(data=payload)

    except ModelNotLoadedError as exc:
        return JSONResponse(
            status_code=503,
            content=ErrorResponse(
                detail=f"Weather model unavailable: {exc}",
                error_code="MODEL_NOT_LOADED",
            ).model_dump(),
        )
    except DataFetchError as exc:
        return JSONResponse(
            status_code=502,
            content=ErrorResponse(
                detail=f"Data fetch failed: {exc}",
                error_code="DATA_FETCH_ERROR",
            ).model_dump(),
        )
    except GPUOutOfMemoryError as exc:
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(
                detail=f"GPU out of memory (VRAM used: {exc.vram_used_gb:.2f} GB): {exc}",
                error_code="GPU_OOM",
            ).model_dump(),
        )


# ── GET /api/forecast/weather/cities ────────────────────────────────


@router.get("/cities", response_model=SuccessResponse[CitiesForecastResponse])
async def cities_forecast(
    start_time: str = Query(
        default="2021-02-13T00:00:00",
        examples=["2021-02-13T00:00:00"],
    ),
) -> SuccessResponse[CitiesForecastResponse] | JSONResponse:
    """City-level point forecasts for all monitored cities."""
    try:
        dt = _parse_start_time(start_time)
        data = await weather_service.get_city_forecasts(dt)
        payload = CitiesForecastResponse(**data)
        return SuccessResponse(data=payload)

    except ModelNotLoadedError as exc:
        return JSONResponse(
            status_code=503,
            content=ErrorResponse(
                detail=f"Weather model unavailable: {exc}",
                error_code="MODEL_NOT_LOADED",
            ).model_dump(),
        )
    except DataFetchError as exc:
        return JSONResponse(
            status_code=502,
            content=ErrorResponse(
                detail=f"Data fetch failed: {exc}",
                error_code="DATA_FETCH_ERROR",
            ).model_dump(),
        )
    except GPUOutOfMemoryError as exc:
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(
                detail=f"GPU out of memory (VRAM used: {exc.vram_used_gb:.2f} GB): {exc}",
                error_code="GPU_OOM",
            ).model_dump(),
        )


# ── GET /api/forecast/weather/cities/{city_name} ────────────────────


@router.get("/cities/{city_name}", response_model=SuccessResponse[CityForecast])
async def single_city_forecast(
    city_name: str = Path(
        ...,
        examples=["Austin, TX"],
        description="City name (e.g. 'Austin, TX', 'austin-tx', 'austintx')",
    ),
    start_time: str = Query(
        default="2021-02-13T00:00:00",
        examples=["2021-02-13T00:00:00"],
    ),
) -> SuccessResponse[CityForecast] | JSONResponse:
    """Single-city point forecast.  Returns 404 if city is not monitored."""
    resolved = resolve_city_name(city_name)
    if resolved is None:
        raise HTTPException(status_code=404, detail=f"City not found: {city_name}")

    try:
        dt = _parse_start_time(start_time)
        data = await weather_service.get_city_forecasts(dt)
        city_data = data["cities"][resolved]
        payload = CityForecast(**city_data)
        return SuccessResponse(data=payload)

    except ModelNotLoadedError as exc:
        return JSONResponse(
            status_code=503,
            content=ErrorResponse(
                detail=f"Weather model unavailable: {exc}",
                error_code="MODEL_NOT_LOADED",
            ).model_dump(),
        )
    except DataFetchError as exc:
        return JSONResponse(
            status_code=502,
            content=ErrorResponse(
                detail=f"Data fetch failed: {exc}",
                error_code="DATA_FETCH_ERROR",
            ).model_dump(),
        )
    except GPUOutOfMemoryError as exc:
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(
                detail=f"GPU out of memory (VRAM used: {exc.vram_used_gb:.2f} GB): {exc}",
                error_code="GPU_OOM",
            ).model_dump(),
        )


# ── POST /api/forecast/weather/run ──────────────────────────────────


@router.post("/run", response_model=SuccessResponse[SFNOGridForecast])
async def force_run(
    body: WeatherRunRequest,
) -> SuccessResponse[SFNOGridForecast] | JSONResponse:
    """Force a new SFNO inference run (ignores cache).  For demo/manual use."""
    try:
        dt = _parse_start_time(body.start_time)
        data = await weather_service.run_forecast(dt, steps=body.steps, force=True)
        steps = [GridTimestep(**s) for s in data["steps"]]
        payload = SFNOGridForecast(
            start_time=data["start_time"],
            region=data["region"],
            generated_at=data["generated_at"],
            steps=steps,
        )
        return SuccessResponse(data=payload)

    except ModelNotLoadedError as exc:
        return JSONResponse(
            status_code=503,
            content=ErrorResponse(
                detail=f"Weather model unavailable: {exc}",
                error_code="MODEL_NOT_LOADED",
            ).model_dump(),
        )
    except DataFetchError as exc:
        return JSONResponse(
            status_code=502,
            content=ErrorResponse(
                detail=f"Data fetch failed: {exc}",
                error_code="DATA_FETCH_ERROR",
            ).model_dump(),
        )
    except GPUOutOfMemoryError as exc:
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(
                detail=f"GPU out of memory (VRAM used: {exc.vram_used_gb:.2f} GB): {exc}",
                error_code="GPU_OOM",
            ).model_dump(),
        )


# ── GET /api/forecast/weather/status ────────────────────────────────


@router.get("/status", response_model=SuccessResponse[WeatherStatusResponse])
async def weather_status() -> SuccessResponse[WeatherStatusResponse]:
    """Return SFNO model / GPU / cache status."""
    data = weather_service.get_status()
    return SuccessResponse(data=WeatherStatusResponse(**data))
