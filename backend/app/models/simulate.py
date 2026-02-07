"""Pydantic models for cascade simulation request / response."""

from datetime import datetime
from typing import Dict, List

from pydantic import BaseModel, Field


# ── Request ─────────────────────────────────────────────────────────


class CascadeRequest(BaseModel):
    scenario: str = Field(
        default="uri",
        examples=["uri", "normal", "live"],
        description="Scenario name — uri, normal, or live",
    )
    start_time: str = Field(
        default="2021-02-13T00:00:00",
        examples=["2021-02-13T00:00:00"],
        description="ISO datetime for the weather scenario (legacy, overridden by scenario)",
    )
    forecast_hour: int = Field(
        default=36,
        ge=0,
        le=48,
        examples=[36],
        description="Hour offset into the forecast to simulate",
    )
    region: str = Field(default="ERCOT", examples=["ERCOT"])


# ── Response sub-objects ────────────────────────────────────────────


class FailedNodeInfo(BaseModel):
    id: str
    lat: float
    lon: float
    load_mw: float
    capacity_mw: float


class CascadeStep(BaseModel):
    step: int
    new_failures: List[FailedNodeInfo]
    total_failed: int
    total_load_shed_mw: float


class FinalNodeState(BaseModel):
    status: str  # "failed" | "stressed" | "nominal"
    current_load_mw: float
    capacity_mw: float
    load_pct: float


class CascadeResult(BaseModel):
    scenario: str
    forecast_hour: int
    started_at: datetime
    completed_at: datetime
    steps: List[CascadeStep]
    total_failed_nodes: int
    total_nodes: int
    cascade_depth: int
    total_load_shed_mw: float
    failed_node_ids: List[str]
    final_node_states: Dict[str, FinalNodeState]
