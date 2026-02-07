from contextlib import asynccontextmanager
from typing import Dict

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routers import consumer, forecast, grid, notifications, orchestrate, simulate, utility, weather
from app.schemas.responses import ErrorResponse
from app.services.ercot_data_service import ercot_data
from app.services.grid_graph_service import grid_graph
from app.services.grid_service import prewarm_cascade_cache
from app.services.price_service import price_service
from app.services.weather_service import weather_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: load ACTIVSg2000 grid, ERCOT load data, weather model, price model.
    grid_graph.load()
    ercot_data.load()
    await weather_service.load_model()
    await price_service.load_model()

    # Pre-warm cascade probability cache (runs in background)
    prewarm_cascade_cache()

    yield
    # Shutdown: nothing to clean up — model memory freed automatically.


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Blackout API — grid forecasting, simulation, and consumer intelligence",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(weather.router)
app.include_router(forecast.router)
app.include_router(grid.router)
app.include_router(simulate.router)
app.include_router(consumer.router)
app.include_router(utility.router)
app.include_router(orchestrate.router)
app.include_router(notifications.router)


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=ErrorResponse(
            detail=str(exc),
            error_code="VALIDATION_ERROR",
        ).model_dump(),
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            detail="An unexpected error occurred.",
            error_code="INTERNAL_SERVER_ERROR",
        ).model_dump(),
    )


@app.get("/health", tags=["health"])
async def health_check() -> Dict[str, str]:
    return {"status": "ok"}
