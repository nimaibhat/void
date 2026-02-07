from datetime import datetime
from enum import Enum
from typing import List

from pydantic import BaseModel, Field


class TriggerType(str, Enum):
    HEATWAVE = "heatwave"
    COLD_SNAP = "cold_snap"
    CYBERATTACK = "cyberattack"
    EQUIPMENT_FAILURE = "equipment_failure"
    DEMAND_SPIKE = "demand_spike"
    FUEL_SHORTAGE = "fuel_shortage"


class CascadeScenario(BaseModel):
    """Input scenario for cascade simulation."""

    trigger: TriggerType = Field(..., examples=["heatwave"])
    region: str = Field(..., examples=["ERCOT"])
    severity: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Severity factor from 0 (mild) to 1 (extreme)",
        examples=[0.8],
    )
    duration_hours: int = Field(default=24, ge=1, le=720, examples=[72])
    include_secondary_effects: bool = Field(default=True)

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "trigger": "heatwave",
                    "region": "ERCOT",
                    "severity": 0.8,
                    "duration_hours": 72,
                    "include_secondary_effects": True,
                }
            ]
        }
    }


class CascadeEvent(BaseModel):
    hour: int
    event: str
    affected_region: str
    load_shed_mw: float
    customers_affected: int


class CascadeSimulationResponse(BaseModel):
    simulation_id: str
    scenario: CascadeScenario
    started_at: datetime
    completed_at: datetime
    total_load_shed_mw: float
    peak_customers_affected: int
    cascade_events: List[CascadeEvent]
    risk_score: float = Field(ge=0.0, le=10.0)
