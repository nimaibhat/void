from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class ISORegion(str, Enum):
    CAISO = "CAISO"
    ERCOT = "ERCOT"
    PJM = "PJM"
    MISO = "MISO"
    NYISO = "NYISO"
    ISONE = "ISO-NE"
    SPP = "SPP"


# --- Weather Forecast ---


class WeatherForecastRequest(BaseModel):
    """Query parameters for weather forecast."""

    latitude: float = Field(..., ge=-90, le=90, examples=[37.7749])
    longitude: float = Field(..., ge=-180, le=180, examples=[-122.4194])
    hours_ahead: int = Field(default=24, ge=1, le=168, examples=[48])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "latitude": 37.7749,
                    "longitude": -122.4194,
                    "hours_ahead": 48,
                }
            ]
        }
    }


class HourlyWeather(BaseModel):
    timestamp: datetime
    temperature_f: float
    humidity_pct: float
    wind_speed_mph: float
    cloud_cover_pct: float
    precipitation_in: float


class WeatherForecastResponse(BaseModel):
    latitude: float
    longitude: float
    model: str = Field(examples=["earth2-fourcastnet"])
    generated_at: datetime
    hourly: List[HourlyWeather]


# --- Price Forecast ---


class PriceForecastRequest(BaseModel):
    """Query parameters for price forecast."""

    iso: ISORegion = Field(..., examples=["CAISO"])
    hours_ahead: int = Field(default=24, ge=1, le=168, examples=[24])
    node_id: Optional[str] = Field(default=None, examples=["LAPLMG1_7_B2"])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "iso": "CAISO",
                    "hours_ahead": 24,
                    "node_id": "LAPLMG1_7_B2",
                }
            ]
        }
    }


class HourlyPrice(BaseModel):
    timestamp: datetime
    lmp_dollar_per_mwh: float
    congestion_dollar_per_mwh: float
    loss_dollar_per_mwh: float


class PriceForecastResponse(BaseModel):
    iso: ISORegion
    node_id: Optional[str]
    generated_at: datetime
    hourly: List[HourlyPrice]
