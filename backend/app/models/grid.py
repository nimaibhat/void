"""Pydantic models for grid topology, node status, and cascade probability."""

from datetime import datetime
from enum import Enum
from typing import Dict, List

from pydantic import BaseModel, Field


# ── Enums ───────────────────────────────────────────────────────────


class NodeStatus(str, Enum):
    FAILED = "failed"
    STRESSED = "stressed"
    NOMINAL = "nominal"


# ── Topology ────────────────────────────────────────────────────────


class GridNode(BaseModel):
    id: str
    lat: float
    lon: float
    base_load_mw: float
    capacity_mw: float
    voltage_kv: float
    region: str


class GridEdge(BaseModel):
    from_bus: str
    to_bus: str
    capacity_mva: float
    impedance: float


class GridTopologyResponse(BaseModel):
    total_nodes: int
    total_edges: int
    region: str
    nodes: List[GridNode]
    edges: List[GridEdge]


# ── Grid status (with demand applied) ──────────────────────────────


class GridStatusNode(BaseModel):
    id: str
    lat: float
    lon: float
    status: NodeStatus
    load_pct: float
    load_mw: float
    capacity_mw: float


class GridStatusSummary(BaseModel):
    total_nodes: int
    stressed_count: int
    failed_count: int
    nominal_count: int
    total_load_mw: float
    total_capacity_mw: float
    cascade_probability: float


class GridStatusResponse(BaseModel):
    scenario: str
    forecast_hour: int
    generated_at: datetime
    nodes: List[GridStatusNode]
    edges: List[GridEdge]
    summary: GridStatusSummary


# ── Single node detail ──────────────────────────────────────────────


class NodeDetailResponse(BaseModel):
    id: str
    lat: float
    lon: float
    load_mw: float
    capacity_mw: float
    load_pct: float
    status: NodeStatus
    voltage_kv: float
    region: str
    connected_nodes: List[str]
    risk_level: str = Field(
        description="low / medium / high / critical based on load_pct"
    )


# ── Cascade probability per region ─────────────────────────────────


class CascadeProbabilityResponse(BaseModel):
    probabilities: Dict[str, float]
    forecast_hour: int
    scenario: str


# ── Hotspots & Arcs (operator globe) ─────────────────────────────


class GridHotspot(BaseModel):
    id: str
    name: str
    lat: float
    lon: float
    status: str = Field(description="critical / stressed / normal")
    load_mw: float
    capacity_mw: float
    outage_risk_pct: float


class GridArc(BaseModel):
    source: str
    target: str
    source_coords: List[float] = Field(description="[lat, lon]")
    target_coords: List[float] = Field(description="[lat, lon]")
    flow_mw: float
    capacity_mw: float
    utilization_pct: float
    status: str = Field(description="critical / stressed / normal")


class HotspotsResponse(BaseModel):
    hotspots: List[GridHotspot]
    scenario: str


class ArcsResponse(BaseModel):
    arcs: List[GridArc]
    scenario: str
