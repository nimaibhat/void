from contextlib import asynccontextmanager
from typing import Dict

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routers import consumer, forecast, grid, simulate, utility
from app.schemas.responses import ErrorResponse


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize connections, caches, etc.
    # TODO: Add startup logic (DB connections, model loading, etc.)
    yield
    # Shutdown: clean up resources
    # TODO: Add shutdown logic (close connections, flush buffers, etc.)


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

app.include_router(forecast.router)
app.include_router(grid.router)
app.include_router(simulate.router)
app.include_router(consumer.router)
app.include_router(utility.router)


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
