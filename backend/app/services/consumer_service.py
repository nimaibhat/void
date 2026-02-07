"""Consumer Optimization Service — appliance scheduling, battery arbitrage,
solar earnings, readiness scoring, and alert generation.

Uses the price forecast to find optimal run windows for flexible appliances,
charge/discharge cycles for home batteries, and solar export timing.
"""

from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from app.models.consumer import (
    ActionCategory,
    Alert,
    AlertSeverity,
    Appliance,
    ConsumerProfile,
    ConsumerProfilesResponse,
    ConsumerRecommendation,
    ConsumerStatus,
    CreateCustomProfileRequest,
    OptimizedSchedule,
    ProfileType,
    SavingsSummary,
)
from app.models.price import HourlyPrice, PricingMode
from app.services.price_service import price_service

# ── Built-in profiles ────────────────────────────────────────────────

PROFILES: Dict[str, ConsumerProfile] = {
    "martinez-family": ConsumerProfile(
        profile_id="martinez-family",
        name="Martinez Family",
        profile_type=ProfileType.PRE_MADE,
        household_size=5,
        square_footage=2400,
        has_solar=True,
        has_battery=True,
        has_ev=False,
        hvac_type="central_ac",
        avg_monthly_kwh=1100.0,
    ),
    "default-suburban-family": ConsumerProfile(
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
    "default-eco-home": ConsumerProfile(
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
    "default-apartment": ConsumerProfile(
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
}

# ── Appliance templates per profile ──────────────────────────────────

PROFILE_APPLIANCES: Dict[str, List[Appliance]] = {
    "martinez-family": [
        Appliance(name="Dishwasher", power_kw=1.8, duration_hours=1.5,
                  preferred_start=19, category=ActionCategory.APPLIANCE),
        Appliance(name="Clothes Dryer", power_kw=5.0, duration_hours=1.0,
                  preferred_start=10, category=ActionCategory.APPLIANCE),
        Appliance(name="Water Heater", power_kw=4.5, duration_hours=1.0,
                  preferred_start=7, category=ActionCategory.APPLIANCE),
    ],
    "default-suburban-family": [
        Appliance(name="Dishwasher", power_kw=1.8, duration_hours=1.5,
                  preferred_start=19, category=ActionCategory.APPLIANCE),
        Appliance(name="Clothes Dryer", power_kw=5.0, duration_hours=1.0,
                  preferred_start=10, category=ActionCategory.APPLIANCE),
        Appliance(name="Water Heater", power_kw=4.5, duration_hours=1.0,
                  preferred_start=7, category=ActionCategory.APPLIANCE),
    ],
    "default-eco-home": [
        Appliance(name="Dishwasher", power_kw=1.8, duration_hours=1.5,
                  preferred_start=20, category=ActionCategory.APPLIANCE),
        Appliance(name="EV Charger", power_kw=7.2, duration_hours=3.0,
                  preferred_start=18, category=ActionCategory.EV),
    ],
    "default-apartment": [
        Appliance(name="Dishwasher", power_kw=1.2, duration_hours=1.5,
                  preferred_start=20, category=ActionCategory.APPLIANCE),
    ],
}

# ── Battery specs: (capacity_kwh, charge_rate_kw) ────────────────────

BATTERY_SPECS: Dict[str, Tuple[float, float]] = {
    "martinez-family": (13.5, 5.0),
    "default-eco-home": (13.5, 5.0),
}

# ── Solar specs: (panel_kw_peak, efficiency) ─────────────────────────

SOLAR_SPECS: Dict[str, Tuple[float, float]] = {
    "martinez-family": (7.5, 0.85),
    "default-eco-home": (8.0, 0.85),
}

# Normalized solar production curve (fraction of peak kW by hour)
SOLAR_CURVE: Dict[int, float] = {
    6: 0.05, 7: 0.15, 8: 0.35, 9: 0.55, 10: 0.75, 11: 0.90,
    12: 1.00, 13: 0.98, 14: 0.90, 15: 0.78, 16: 0.60, 17: 0.35,
    18: 0.10, 19: 0.02,
}

# In-memory custom profile storage
_custom_profiles: Dict[str, ConsumerProfile] = {}


# ── Profile management ───────────────────────────────────────────────


def _get_profile(profile_id: str) -> Optional[ConsumerProfile]:
    """Look up a profile by ID (built-in or custom)."""
    return PROFILES.get(profile_id) or _custom_profiles.get(profile_id)


async def get_profiles() -> ConsumerProfilesResponse:
    """List all available consumer profiles."""
    all_profiles = list(PROFILES.values()) + list(_custom_profiles.values())
    return ConsumerProfilesResponse(profiles=all_profiles, total=len(all_profiles))


async def create_custom_profile(
    request: CreateCustomProfileRequest,
) -> ConsumerProfile:
    """Create and store a custom consumer profile."""
    profile = ConsumerProfile(
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
    _custom_profiles[profile.profile_id] = profile
    return profile


# ── Sliding-window appliance optimization ────────────────────────────


def _window_cost(
    prices: List[HourlyPrice],
    start_hour: int,
    duration_hours: float,
    power_kw: float,
) -> float:
    """Cost of running an appliance for *duration_hours* starting at hour index."""
    total = 0.0
    full_hours = int(duration_hours)
    fractional = duration_hours - full_hours

    for i in range(full_hours):
        idx = start_hour + i
        if idx < len(prices):
            total += prices[idx].consumer_price_kwh * power_kw
    # Fractional last hour
    if fractional > 0 and (start_hour + full_hours) < len(prices):
        total += prices[start_hour + full_hours].consumer_price_kwh * power_kw * fractional

    return round(total, 4)


def _optimize_appliances(
    profile_id: str,
    prices: List[HourlyPrice],
) -> List[OptimizedSchedule]:
    """Find cheapest run window for each flexible appliance."""
    appliances = PROFILE_APPLIANCES.get(profile_id, [])
    schedule: List[OptimizedSchedule] = []

    for app in appliances:
        if not app.flexible:
            continue

        duration_slots = max(1, int(math.ceil(app.duration_hours)))
        original_cost = _window_cost(prices, app.preferred_start, app.duration_hours, app.power_kw)

        # Search all valid start hours within 48h window
        best_start = app.preferred_start
        best_cost = original_cost
        max_start = len(prices) - duration_slots

        for s in range(max_start):
            cost = _window_cost(prices, s, app.duration_hours, app.power_kw)
            if cost < best_cost:
                best_cost = cost
                best_start = s

        savings = round(original_cost - best_cost, 2)
        if savings > 0.01:
            reason = (
                f"Shift from {app.preferred_start}:00 to {best_start % 24}:00 — "
                f"${best_cost:.2f} vs ${original_cost:.2f} at original time"
            )
        else:
            reason = "Already at optimal time"

        schedule.append(OptimizedSchedule(
            appliance=app.name,
            original_start=app.preferred_start,
            optimized_start=best_start % 24,
            original_cost=round(original_cost, 2),
            optimized_cost=round(best_cost, 2),
            savings=max(0.0, savings),
            reason=reason,
        ))

    return schedule


# ── Battery arbitrage optimization ───────────────────────────────────


def _optimize_battery(
    profile_id: str,
    prices: List[HourlyPrice],
) -> Tuple[float, float]:
    """Find optimal charge/discharge windows for battery.

    Returns (savings_dollars, savings_kwh).
    """
    spec = BATTERY_SPECS.get(profile_id)
    if spec is None:
        return 0.0, 0.0

    capacity_kwh, charge_rate_kw = spec
    charge_hours = int(math.ceil(capacity_kwh / charge_rate_kw))

    # Sort hours by price
    indexed = [(i, p.consumer_price_kwh) for i, p in enumerate(prices)]
    by_price = sorted(indexed, key=lambda x: x[1])

    # Cheapest hours for charging
    charge_indices = sorted([h[0] for h in by_price[:charge_hours]])
    # Most expensive hours for discharging
    discharge_indices = sorted([h[0] for h in by_price[-charge_hours:]])

    avg_charge_price = sum(prices[i].consumer_price_kwh for i in charge_indices) / max(1, len(charge_indices))
    avg_discharge_price = sum(prices[i].consumer_price_kwh for i in discharge_indices) / max(1, len(discharge_indices))

    # Round-trip efficiency ~90%
    savings_per_kwh = avg_discharge_price * 0.90 - avg_charge_price
    savings_dollars = round(max(0.0, savings_per_kwh * capacity_kwh), 2)
    savings_kwh = round(capacity_kwh * 0.90, 2) if savings_dollars > 0 else 0.0

    return savings_dollars, savings_kwh


# ── Solar production savings ─────────────────────────────────────────


def _calculate_solar_savings(
    profile_id: str,
    prices: List[HourlyPrice],
) -> Tuple[float, float]:
    """Estimate solar self-consumption + export credit savings.

    Returns (savings_dollars, production_kwh).
    """
    spec = SOLAR_SPECS.get(profile_id)
    if spec is None:
        return 0.0, 0.0

    panel_kw, efficiency = spec
    total_savings = 0.0
    total_kwh = 0.0

    for p in prices:
        hour_of_day = p.hour % 24
        capacity_factor = SOLAR_CURVE.get(hour_of_day, 0.0)
        if capacity_factor <= 0:
            continue

        production_kwh = panel_kw * efficiency * capacity_factor
        total_kwh += production_kwh
        # Solar offsets grid purchase or earns export credits
        total_savings += production_kwh * p.consumer_price_kwh

    return round(total_savings, 2), round(total_kwh, 2)


# ── Readiness score ──────────────────────────────────────────────────


def _compute_readiness(
    profile: ConsumerProfile,
    schedule: List[OptimizedSchedule],
    total_savings: float,
) -> int:
    """Compute household readiness score (0-100)."""
    score = 42
    if profile.has_battery:
        score += 16
    if profile.has_solar:
        score += 14
    if profile.has_ev:
        score += 6
    # Flexible appliance optimization bonus
    flex_count = sum(1 for s in schedule if s.savings > 0)
    score += min(12, flex_count * 4)
    # Savings effectiveness bonus (capped at 10)
    score += min(10, int(total_savings))
    return min(100, score)


def _compute_status(readiness: int) -> ConsumerStatus:
    """Map readiness score to consumer status."""
    if readiness >= 80:
        return ConsumerStatus.PROTECTED
    if readiness >= 50:
        return ConsumerStatus.AT_RISK
    return ConsumerStatus.VULNERABLE


# ── Alert generation ─────────────────────────────────────────────────


def _generate_alerts(
    profile: ConsumerProfile,
    prices: List[HourlyPrice],
    readiness: int,
) -> List[Alert]:
    """Generate contextual alerts based on price forecast and profile."""
    now = datetime.now(timezone.utc)
    alerts: List[Alert] = []

    # Find peak price hours
    peak_prices = sorted(prices, key=lambda p: p.price_mwh, reverse=True)
    peak_hour = peak_prices[0] if peak_prices else None

    # High grid utilization alert
    high_util = [p for p in prices if p.grid_utilization_pct > 85]
    if high_util:
        alerts.append(Alert(
            severity=AlertSeverity.WARNING,
            title="Grid Stress Detected",
            description=(
                f"{len(high_util)} hours with grid utilization above 85%. "
                "Reduce non-essential load during peak periods."
            ),
            timestamp=now,
            action="Pre-cool home and shift flexible loads to off-peak hours",
        ))

    # Extreme price alert
    extreme = [p for p in prices if p.price_mwh > 200]
    if extreme:
        alerts.append(Alert(
            severity=AlertSeverity.CRITICAL,
            title="Extreme Price Spike Expected",
            description=(
                f"{len(extreme)} hours with wholesale prices above $200/MWh. "
                f"Peak: ${peak_hour.price_mwh:.0f}/MWh" if peak_hour else ""
            ),
            timestamp=now,
            action="Activate battery discharge and minimize consumption",
        ))

    # Battery recommendation
    if not profile.has_battery and readiness < 80:
        alerts.append(Alert(
            severity=AlertSeverity.INFO,
            title="Battery Storage Recommended",
            description=(
                "Adding a home battery could increase your readiness score "
                "and save on peak pricing through arbitrage."
            ),
            timestamp=now,
            action="Consider Tesla Powerwall or similar home battery system",
        ))

    # Solar recommendation
    if not profile.has_solar:
        alerts.append(Alert(
            severity=AlertSeverity.INFO,
            title="Solar Panels Recommended",
            description=(
                "Solar generation can offset peak consumption and earn "
                "export credits during high-price windows."
            ),
            timestamp=now,
            action="Get a solar assessment for your property",
        ))

    return alerts


def _find_next_risk_window(prices: List[HourlyPrice]) -> Optional[str]:
    """Find the next window where grid utilization exceeds 80%."""
    for p in prices:
        if p.grid_utilization_pct > 80:
            hour = p.hour % 24
            period = "AM" if hour < 12 else "PM"
            display_hour = hour if hour <= 12 else hour - 12
            if display_hour == 0:
                display_hour = 12
            return f"Today {display_hour}:00 {period}"
    return None


# ── Public API ────────────────────────────────────────────────────────


async def get_recommendations(
    profile_id: str,
    region: str = "ERCOT",
    scenario: str = "normal",
) -> ConsumerRecommendation:
    """Full optimization pipeline: prices → appliances → battery → solar."""
    profile = _get_profile(profile_id)
    if profile is None:
        raise ValueError(f"Unknown profile: {profile_id}")

    # Get 48-hour price forecast
    prices = price_service.get_price_forecast(
        region=region,
        mode=PricingMode.HYBRID,
        scenario=scenario,
    )

    # Optimize appliance scheduling
    schedule = _optimize_appliances(profile_id, prices)

    # Battery arbitrage
    battery_savings, battery_kwh = _optimize_battery(profile_id, prices)
    if battery_savings > 0:
        schedule.append(OptimizedSchedule(
            appliance="Battery (charge/discharge)",
            original_start=0,
            optimized_start=0,
            original_cost=0.0,
            optimized_cost=0.0,
            savings=battery_savings,
            reason=f"Charge at off-peak, discharge at peak — {battery_kwh} kWh cycled",
        ))

    # Solar savings
    solar_savings, solar_kwh = _calculate_solar_savings(profile_id, prices)
    if solar_savings > 0:
        schedule.append(OptimizedSchedule(
            appliance="Solar Generation",
            original_start=0,
            optimized_start=0,
            original_cost=solar_savings,
            optimized_cost=0.0,
            savings=solar_savings,
            reason=f"Self-consumption + export credits — {solar_kwh} kWh produced",
        ))

    total_savings = round(sum(s.savings for s in schedule), 2)
    readiness = _compute_readiness(profile, schedule, total_savings)
    status = _compute_status(readiness)
    alerts = _generate_alerts(profile, prices, readiness)
    next_risk = _find_next_risk_window(prices)

    return ConsumerRecommendation(
        profile=profile,
        optimized_schedule=schedule,
        total_savings=total_savings,
        readiness_score=readiness,
        status=status,
        alerts=alerts,
        next_risk_window=next_risk,
    )


async def get_savings(
    profile_id: str,
    region: str = "ERCOT",
    scenario: str = "normal",
) -> SavingsSummary:
    """Compute savings summary for a profile."""
    rec = await get_recommendations(profile_id, region, scenario)
    total_kwh = sum(
        s.savings / max(0.01, s.original_cost) * s.savings
        for s in rec.optimized_schedule
        if s.original_cost > 0
    )
    return SavingsSummary(
        profile_id=profile_id,
        total_savings_dollars=rec.total_savings,
        total_savings_kwh=round(total_kwh, 2),
        readiness_score=rec.readiness_score,
        status=rec.status,
        optimized_schedule=rec.optimized_schedule,
        period_hours=48,
    )
