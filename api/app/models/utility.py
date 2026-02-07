from datetime import datetime
from typing import List

from pydantic import BaseModel, Field


class CrewAssignment(BaseModel):
    crew_id: str
    region: str
    priority_score: float = Field(ge=0.0, le=10.0)
    assigned_zone: str
    skill_set: List[str]
    estimated_travel_minutes: int


class CrewOptimizationRequest(BaseModel):
    """Query parameters for crew optimization."""

    region: str = Field(..., examples=["CAISO"])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "region": "CAISO",
                }
            ]
        }
    }


class CrewOptimizationResponse(BaseModel):
    region: str
    generated_at: datetime
    total_crews: int
    assignments: List[CrewAssignment]
    coverage_score: float = Field(ge=0.0, le=1.0)
