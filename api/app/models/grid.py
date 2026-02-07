from datetime import datetime
from enum import Enum
from typing import List

from pydantic import BaseModel, Field


class StressLevel(str, Enum):
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"
    CRITICAL = "critical"


class RegionGridStatus(BaseModel):
    region: str = Field(examples=["CAISO"])
    stress_level: StressLevel
    load_mw: float
    capacity_mw: float
    reserve_margin_pct: float
    renewable_pct: float
    outages_active: int


class GridStatusResponse(BaseModel):
    generated_at: datetime
    national_stress: StressLevel
    regions: List[RegionGridStatus]
