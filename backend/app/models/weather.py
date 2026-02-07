"""Pydantic models for SFNO weather forecast endpoints."""

from datetime import datetime
from typing import Dict, List

from pydantic import BaseModel, ConfigDict, Field


# ── Grid forecast ───────────────────────────────────────────────────


class GridBounds(BaseModel):
    lat_min: float
    lat_max: float
    lon_min: float
    lon_max: float


class GridTimestep(BaseModel):
    """One forecast timestep with 2D grids over the US region."""

    model_config = ConfigDict(extra="ignore")

    step: int
    hour: int
    timestamp: str
    temperature_f: List[List[float]]
    wind_mph: List[List[float]]
    pressure_hpa: List[List[float]]
    grid_bounds: GridBounds


class SFNOGridForecast(BaseModel):
    model: str = "earth2studio-sfno"
    start_time: str
    region: str
    generated_at: str
    steps: List[GridTimestep]


# ── City forecasts ──────────────────────────────────────────────────


class CityHourly(BaseModel):
    hour: int
    timestamp: str
    temp_f: float
    wind_mph: float
    wind_dir_deg: float
    pressure_hpa: float


class CityForecast(BaseModel):
    lat: float
    lon: float
    hourly: List[CityHourly]


class CitiesForecastResponse(BaseModel):
    model: str = "earth2studio-sfno"
    start_time: str
    generated_at: str
    cities: Dict[str, CityForecast]


# ── Run request ─────────────────────────────────────────────────────


class WeatherRunRequest(BaseModel):
    start_time: str = Field(
        default="2021-02-13T00:00:00",
        examples=["2021-02-13T00:00:00"],
    )
    steps: int = Field(default=8, ge=1, le=40, examples=[8])


# ── Status ──────────────────────────────────────────────────────────


class WeatherStatusResponse(BaseModel):
    model_loaded: bool
    gpu_name: str
    cached_scenarios: List[str]
    vram_used_gb: float
