"""Price prediction models — hourly forecasts, pricing modes, model info."""

from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class PricingMode(str, Enum):
    ML = "ml"
    RULES = "rules"
    HYBRID = "hybrid"


class HourlyPrice(BaseModel):
    hour: int = Field(ge=0, le=47)
    timestamp: datetime
    price_mwh: float
    consumer_price_kwh: float
    demand_factor: float
    wind_gen_factor: float
    grid_utilization_pct: float
    zone: str
    prediction_mode: PricingMode


class PriceForecastResponse(BaseModel):
    region: str
    start_time: datetime
    mode: PricingMode
    prices: List[HourlyPrice]


class ModelInfoResponse(BaseModel):
    model_loaded: bool
    training_date: Optional[datetime] = None
    feature_names: List[str] = Field(default_factory=list)
    training_score: Optional[float] = None
    training_samples: Optional[int] = None
