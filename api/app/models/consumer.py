from datetime import datetime
from enum import Enum
from typing import List

from pydantic import BaseModel, Field


class UrgencyLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ActionCategory(str, Enum):
    THERMOSTAT = "thermostat"
    APPLIANCE = "appliance"
    EV = "ev"
    SOLAR = "solar"
    BATTERY = "battery"
    BEHAVIORAL = "behavioral"


# --- Recommendations ---


class RecommendationRequest(BaseModel):
    """Query parameters for consumer recommendations."""

    profile_id: str = Field(..., examples=["default-suburban-family"])
    region: str = Field(..., examples=["CAISO"])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "profile_id": "default-suburban-family",
                    "region": "CAISO",
                }
            ]
        }
    }


class Recommendation(BaseModel):
    action: str
    category: ActionCategory
    urgency: UrgencyLevel
    estimated_savings_kwh: float
    estimated_savings_dollars: float
    reason: str


class RecommendationsResponse(BaseModel):
    profile_id: str
    region: str
    generated_at: datetime
    recommendations: List[Recommendation]


# --- Consumer Profiles ---


class ProfileType(str, Enum):
    PRE_MADE = "pre_made"
    CUSTOM = "custom"


class ConsumerProfile(BaseModel):
    profile_id: str
    name: str
    profile_type: ProfileType
    household_size: int = Field(ge=1, le=20)
    square_footage: int = Field(ge=100, le=50000)
    has_solar: bool = False
    has_battery: bool = False
    has_ev: bool = False
    hvac_type: str = Field(examples=["central_ac"])
    avg_monthly_kwh: float


class ConsumerProfilesResponse(BaseModel):
    profiles: List[ConsumerProfile]
    total: int


class CreateCustomProfileRequest(BaseModel):
    """Request body for creating a custom consumer profile."""

    name: str = Field(..., min_length=1, max_length=100, examples=["My Home"])
    household_size: int = Field(..., ge=1, le=20, examples=[4])
    square_footage: int = Field(..., ge=100, le=50000, examples=[2200])
    has_solar: bool = False
    has_battery: bool = False
    has_ev: bool = False
    hvac_type: str = Field(default="central_ac", examples=["central_ac"])
    avg_monthly_kwh: float = Field(..., gt=0, examples=[950.0])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "name": "My Home",
                    "household_size": 4,
                    "square_footage": 2200,
                    "has_solar": True,
                    "has_battery": False,
                    "has_ev": True,
                    "hvac_type": "central_ac",
                    "avg_monthly_kwh": 950.0,
                }
            ]
        }
    }
