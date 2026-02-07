"""Pydantic models for utility operator endpoints."""

from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel


# ── Enums ───────────────────────────────────────────────────────────


class RegionStatus(str, Enum):
    NORMAL = "normal"
    STRESSED = "stressed"
    CRITICAL = "critical"
    BLACKOUT = "blackout"


class CrewStatus(str, Enum):
    DEPLOYED = "deployed"
    STANDBY = "standby"
    EN_ROUTE = "en_route"


class EventSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"
    EMERGENCY = "emergency"


# ── Overview ────────────────────────────────────────────────────────


class WeatherThreat(BaseModel):
    temp_f: float
    wind_mph: float
    condition: str
    is_extreme: bool


class RegionOverview(BaseModel):
    region_id: str
    name: str
    status: RegionStatus
    load_mw: float
    capacity_mw: float
    utilization_pct: float
    weather: WeatherThreat
    outage_count: int
    affected_customers: int


class NationalOverview(BaseModel):
    national_status: RegionStatus
    grid_frequency_hz: float
    total_load_mw: float
    total_capacity_mw: float
    regions: List[RegionOverview]
    timestamp: datetime


# ── Crews ───────────────────────────────────────────────────────────


class Crew(BaseModel):
    crew_id: str
    name: str
    status: CrewStatus
    lat: float
    lon: float
    city: str
    specialty: str
    assigned_region: Optional[str] = None
    eta_minutes: Optional[int] = None


class CrewOptimizationResponse(BaseModel):
    crews: List[Crew]
    total_deployed: int
    coverage_pct: float


# ── Events ──────────────────────────────────────────────────────────


class TimelineEvent(BaseModel):
    event_id: str
    timestamp_offset_minutes: int
    title: str
    description: str
    severity: EventSeverity
    region: Optional[str] = None
    affected_nodes: int = 0


# ── Outcomes ────────────────────────────────────────────────────────


class ScenarioOutcome(BaseModel):
    scenario_name: str
    total_affected_customers: int
    peak_price_mwh: float
    blackout_duration_hours: float
    regions_affected: int
    cascade_steps: int
    failed_nodes: int


class OutcomeComparison(BaseModel):
    without_blackout: ScenarioOutcome
    with_blackout: ScenarioOutcome
    customers_saved: int
    price_reduction_pct: float
    cascade_reduction_pct: float
