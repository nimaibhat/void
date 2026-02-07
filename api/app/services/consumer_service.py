import uuid
from datetime import datetime, timezone

from app.models.consumer import (
    ActionCategory,
    ConsumerProfile,
    ConsumerProfilesResponse,
    CreateCustomProfileRequest,
    ProfileType,
    Recommendation,
    RecommendationsResponse,
    UrgencyLevel,
)


async def get_recommendations(
    profile_id: str,
    region: str,
) -> RecommendationsResponse:
    """Generate personalized energy-saving recommendations for a household.

    This should combine the consumer's profile (appliances, solar, EV, etc.)
    with current grid conditions and price forecasts to produce actionable
    recommendations sorted by impact.

    Args:
        profile_id: Consumer profile identifier.
        region: ISO region the consumer is located in.

    Returns:
        RecommendationsResponse with prioritized action items.
    """
    # TODO: Implement actual recommendation engine here
    now = datetime.now(timezone.utc)
    recommendations = [
        Recommendation(
            action="Pre-cool home to 72°F before 3 PM peak",
            category=ActionCategory.THERMOSTAT,
            urgency=UrgencyLevel.HIGH,
            estimated_savings_kwh=4.2,
            estimated_savings_dollars=1.05,
            reason="Peak pricing window 3-7 PM today; pre-cooling avoids running AC during highest rates.",
        ),
        Recommendation(
            action="Delay dishwasher cycle until after 9 PM",
            category=ActionCategory.APPLIANCE,
            urgency=UrgencyLevel.MEDIUM,
            estimated_savings_kwh=1.8,
            estimated_savings_dollars=0.45,
            reason="Off-peak rates begin at 9 PM; shifting flexible loads saves on TOU tariff.",
        ),
        Recommendation(
            action="Charge EV between 11 PM and 5 AM",
            category=ActionCategory.EV,
            urgency=UrgencyLevel.MEDIUM,
            estimated_savings_kwh=12.0,
            estimated_savings_dollars=3.60,
            reason="Super off-peak window offers lowest rates and grid has surplus renewable generation.",
        ),
        Recommendation(
            action="Export stored battery energy during 4-6 PM",
            category=ActionCategory.BATTERY,
            urgency=UrgencyLevel.HIGH,
            estimated_savings_kwh=0.0,
            estimated_savings_dollars=5.20,
            reason="NEM 3.0 export credits are highest during this window; sell excess to grid.",
        ),
    ]
    return RecommendationsResponse(
        profile_id=profile_id,
        region=region,
        generated_at=now,
        recommendations=recommendations,
    )


async def get_profiles() -> ConsumerProfilesResponse:
    """List all available consumer profiles (pre-made and user-created).

    This should query the profile store (database or cache) and return
    both built-in archetypes and any custom profiles the user has saved.

    Returns:
        ConsumerProfilesResponse with list of profiles.
    """
    # TODO: Implement actual profile storage/retrieval here
    profiles = [
        ConsumerProfile(
            profile_id="default-suburban-family",
            name="Suburban Family",
            profile_type=ProfileType.PRE_MADE,
            household_size=4,
            square_footage=2200,
            has_solar=False,
            has_battery=False,
            has_ev=False,
            hvac_type="central_ac",
            avg_monthly_kwh=950.0,
        ),
        ConsumerProfile(
            profile_id="default-eco-home",
            name="Eco-Conscious Home",
            profile_type=ProfileType.PRE_MADE,
            household_size=2,
            square_footage=1600,
            has_solar=True,
            has_battery=True,
            has_ev=True,
            hvac_type="heat_pump",
            avg_monthly_kwh=400.0,
        ),
        ConsumerProfile(
            profile_id="default-apartment",
            name="Urban Apartment",
            profile_type=ProfileType.PRE_MADE,
            household_size=1,
            square_footage=750,
            has_solar=False,
            has_battery=False,
            has_ev=False,
            hvac_type="window_unit",
            avg_monthly_kwh=550.0,
        ),
    ]
    return ConsumerProfilesResponse(
        profiles=profiles,
        total=len(profiles),
    )


async def create_custom_profile(
    request: CreateCustomProfileRequest,
) -> ConsumerProfile:
    """Create and persist a custom consumer profile.

    This should validate the input, generate a unique profile ID,
    persist it to the database, and return the created profile.

    Args:
        request: The profile creation payload.

    Returns:
        The newly created ConsumerProfile.
    """
    # TODO: Implement actual profile persistence here
    return ConsumerProfile(
        profile_id=f"custom-{uuid.uuid4().hex[:8]}",
        name=request.name,
        profile_type=ProfileType.CUSTOM,
        household_size=request.household_size,
        square_footage=request.square_footage,
        has_solar=request.has_solar,
        has_battery=request.has_battery,
        has_ev=request.has_ev,
        hvac_type=request.hvac_type,
        avg_monthly_kwh=request.avg_monthly_kwh,
    )
