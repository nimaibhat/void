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
    STANDBY = "standby"
    DISPATCHED = "dispatched"
    EN_ROUTE = "en_route"
    ON_SITE = "on_site"
    REPAIRING = "repairing"
    COMPLETE = "complete"
    # Legacy alias kept for existing static data
    DEPLOYED = "deployed"


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


# ── Crew Dispatch ─────────────────────────────────────────────────


class FailedNode(BaseModel):
    """A node that failed during cascade simulation."""
    id: str
    lat: float
    lon: float
    load_mw: float
    capacity_mw: float
    voltage_kv: float = 0.0
    weather_zone: str = ""
    failure_type: str = "unknown"  # transmission | substation | distribution | generation


class DispatchAssignment(BaseModel):
    """A recommended or confirmed crew → failed node assignment."""
    assignment_id: str
    crew_id: str
    crew_name: str
    target_node_id: str
    target_lat: float
    target_lon: float
    distance_km: float
    eta_minutes: int
    specialty_match: str  # exact | partial | mismatch
    match_score: float
    failure_type: str
    status: CrewStatus = CrewStatus.DISPATCHED
    repair_minutes: int = 60
    dispatched_at: Optional[datetime] = None
    arrived_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class DispatchRecommendation(BaseModel):
    """Auto-dispatch recommendation response."""
    assignments: List[DispatchAssignment]
    unassigned_nodes: List[FailedNode]
    total_crews_available: int
    total_failed_nodes: int
    avg_eta_minutes: float
    coverage_pct: float


class DispatchRequest(BaseModel):
    """Request body for dispatching a single crew."""
    crew_id: str
    target_node_id: str


class DispatchStatusResponse(BaseModel):
    """Current state of all active dispatch assignments."""
    assignments: List[DispatchAssignment]
    crews: List[Crew]
    repaired_nodes: List[str]
    total_dispatched: int
    total_repairing: int
    total_complete: int
