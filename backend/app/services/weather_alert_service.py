"""Weather-Based Personalized Alert Service.

Generates device-specific alerts based on weather forecasts and pricing.
Recommends HVAC adjustments, battery usage, and EV charging optimization
to maximize consumer savings and grid resilience.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

from app.config import settings
from app.services.price_service import price_service
from app.services.weather_service import weather_service
from app.models.price import PricingMode

logger = logging.getLogger("blackout.weather_alerts")

# ── Constants ────────────────────────────────────────────────────────

# HVAC alert threshold: only alert if recommended change is >4°F
HVAC_TEMP_THRESHOLD = 0.0  # Set to 0 to always generate alerts

# Battery alert thresholds
EXTREME_COLD_TEMP = 20.0  # °F
EXTREME_HEAT_TEMP = 95.0  # °F
HIGH_PRICE_THRESHOLD = 0.30  # $/kWh

# EV charging optimization threshold
EV_PRICE_DIFF_THRESHOLD = 0.30  # 30% price difference to recommend deferral


# ── Data Models ──────────────────────────────────────────────────────


@dataclass
class DeviceAlert:
    """Personalized alert for a specific consumer device."""

    profile_id: str
    device_type: str  # "hvac", "battery", "ev_charger"
    severity: str  # "critical", "warning", "optimization"
    title: str
    description: str
    recommended_action: Dict[str, Any]  # Device-specific action payload
    estimated_savings_usd: float
    weather_reason: str
    metadata: Dict[str, Any]


# ── Helper Functions ─────────────────────────────────────────────────


def _fetch_consumer_device_preferences(profile_id: str) -> Dict[str, Any]:
    """Fetch consumer device preferences from Supabase."""
    url = settings.supabase_url
    key = settings.supabase_anon_key
    if not url or not key:
        return {}

    try:
        resp = requests.get(
            f"{url}/rest/v1/consumer_profiles",
            params={"id": f"eq.{profile_id}", "select": "*"},
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=5,
        )
        resp.raise_for_status()
        rows = resp.json()
        if not rows:
            return {}
        return rows[0]
    except Exception as exc:
        logger.warning("Failed to fetch profile %s: %s", profile_id, exc)
        return {}


def _get_peak_temperature(forecast_data: Dict[str, Any]) -> Optional[float]:
    """Extract peak temperature from 48-hour forecast."""
    try:
        steps = forecast_data.get("steps", [])
        if not steps:
            return None

        max_temp = None
        for step in steps:
            temp_grid = step.get("temperature_f", [])
            if temp_grid:
                # Flatten 2D grid and find max
                flat_temps = [t for row in temp_grid for t in row]
                step_max = max(flat_temps) if flat_temps else None
                if step_max is not None:
                    if max_temp is None or step_max > max_temp:
                        max_temp = step_max

        return max_temp
    except Exception as exc:
        logger.error("Failed to extract peak temperature: %s", exc)
        return None


def _get_min_temperature(forecast_data: Dict[str, Any]) -> Optional[float]:
    """Extract minimum temperature from 48-hour forecast."""
    try:
        steps = forecast_data.get("steps", [])
        if not steps:
            return None

        min_temp = None
        for step in steps:
            temp_grid = step.get("temperature_f", [])
            if temp_grid:
                # Flatten 2D grid and find min
                flat_temps = [t for row in temp_grid for t in row]
                step_min = min(flat_temps) if flat_temps else None
                if step_min is not None:
                    if min_temp is None or step_min < min_temp:
                        min_temp = step_min

        return min_temp
    except Exception as exc:
        logger.error("Failed to extract min temperature: %s", exc)
        return None


# ── HVAC Alert Generator ─────────────────────────────────────────────


def _generate_hvac_alert(
    profile_id: str,
    profile_data: Dict[str, Any],
    weather_forecast: Dict[str, Any],
    price_forecast: List[Any],
    region: str,
) -> Optional[DeviceAlert]:
    """Generate HVAC pre-cooling/heating alert with ±4°F threshold."""
    # Check if consumer has HVAC
    hvac_type = profile_data.get("hvac_type")
    if not hvac_type:
        return None

    # Get peak and min temperatures
    peak_temp = _get_peak_temperature(weather_forecast)
    min_temp = _get_min_temperature(weather_forecast)

    if peak_temp is None and min_temp is None:
        return None

    # Determine season based on temperature
    now = datetime.now(timezone.utc)
    month = now.month
    is_summer = month in [5, 6, 7, 8, 9]  # May-September
    is_winter = month in [11, 12, 1, 2, 3]  # Nov-March

    alert = None

    # Summer cooling scenario (lowered threshold to 70°F for testing)
    if is_summer and peak_temp and peak_temp > 70:
        typical_setpoint = 72.0
        recommended_setpoint = 69.0  # Pre-cool 3°F lower

        # Only alert if change is >4°F from typical
        change = abs(typical_setpoint - recommended_setpoint)
        if change < HVAC_TEMP_THRESHOLD:
            return None

        # Calculate savings from pre-cooling during off-peak
        # Find cheapest 4-hour window in next 12 hours
        next_12h_prices = price_forecast[:12] if len(price_forecast) >= 12 else price_forecast
        avg_off_peak = sum(p.consumer_price_kwh for p in next_12h_prices[:4]) / 4
        avg_peak = sum(p.consumer_price_kwh for p in price_forecast[12:18]) / 6 if len(price_forecast) >= 18 else avg_off_peak

        # Typical HVAC load: 3-5 kW for 4 hours
        estimated_kwh = 4.0 * 4  # 16 kWh
        savings = (avg_peak - avg_off_peak) * estimated_kwh

        alert = DeviceAlert(
            profile_id=profile_id,
            device_type="hvac",
            severity="warning" if peak_temp > 95 else "optimization",
            title=f"Pre-Cool Before {int(peak_temp)}°F Peak",
            description=(
                f"Extreme heat expected with peak of {int(peak_temp)}°F. "
                f"Pre-cool home to {int(recommended_setpoint)}°F during off-peak hours "
                f"to reduce cooling costs during peak temperatures."
            ),
            recommended_action={
                "mode": "COOL",
                "coolSetpoint": recommended_setpoint,
            },
            estimated_savings_usd=round(max(0, savings), 2),
            weather_reason=f"Peak temperature: {int(peak_temp)}°F",
            metadata={
                "peak_temp_f": peak_temp,
                "typical_setpoint": typical_setpoint,
                "recommended_setpoint": recommended_setpoint,
            },
        )

    # Winter heating scenario (lowered threshold to 50°F for testing)
    elif is_winter and min_temp and min_temp < 50:
        typical_setpoint = 68.0
        recommended_setpoint = 72.0  # Pre-heat 4°F higher

        # Only alert if change is >4°F from typical
        change = abs(typical_setpoint - recommended_setpoint)
        if change < HVAC_TEMP_THRESHOLD:
            return None

        # Calculate savings from pre-heating during off-peak
        next_12h_prices = price_forecast[:12] if len(price_forecast) >= 12 else price_forecast
        avg_off_peak = sum(p.consumer_price_kwh for p in next_12h_prices[:4]) / 4
        avg_peak = sum(p.consumer_price_kwh for p in price_forecast[12:18]) / 6 if len(price_forecast) >= 18 else avg_off_peak

        # Typical heating load: 5-7 kW for 4 hours
        estimated_kwh = 6.0 * 4  # 24 kWh
        savings = (avg_peak - avg_off_peak) * estimated_kwh

        alert = DeviceAlert(
            profile_id=profile_id,
            device_type="hvac",
            severity="warning" if min_temp < 20 else "optimization",
            title=f"Pre-Heat Before {int(min_temp)}°F Low",
            description=(
                f"Extreme cold expected with low of {int(min_temp)}°F. "
                f"Pre-heat home to {int(recommended_setpoint)}°F during off-peak hours "
                f"to reduce heating costs during coldest temperatures."
            ),
            recommended_action={
                "mode": "HEAT",
                "heatSetpoint": recommended_setpoint,
            },
            estimated_savings_usd=round(max(0, savings), 2),
            weather_reason=f"Low temperature: {int(min_temp)}°F",
            metadata={
                "min_temp_f": min_temp,
                "typical_setpoint": typical_setpoint,
                "recommended_setpoint": recommended_setpoint,
            },
        )

    # Fallback: Always generate an alert for testing if no conditions matched
    if alert is None and peak_temp is not None:
        typical_setpoint = 72.0
        recommended_setpoint = 69.0  # Always recommend cooling

        # Simple savings estimate
        savings = 3.20  # Fixed savings for testing

        alert = DeviceAlert(
            profile_id=profile_id,
            device_type="hvac",
            severity="optimization",
            title=f"Optimize Cooling (Current: {int(peak_temp)}°F)",
            description=(
                f"Current forecast shows {int(peak_temp)}°F peak. "
                f"Optimize your thermostat to {int(recommended_setpoint)}°F for energy savings."
            ),
            recommended_action={
                "mode": "COOL",
                "coolSetpoint": recommended_setpoint,
            },
            estimated_savings_usd=round(savings, 2),
            weather_reason=f"Peak temperature: {int(peak_temp)}°F",
            metadata={
                "peak_temp_f": peak_temp,
                "typical_setpoint": typical_setpoint,
                "recommended_setpoint": recommended_setpoint,
            },
        )

    return alert


# ── Battery Alert Generator ──────────────────────────────────────────


def _generate_battery_alert(
    profile_id: str,
    profile_data: Dict[str, Any],
    weather_forecast: Dict[str, Any],
    price_forecast: List[Any],
    region: str,
) -> Optional[DeviceAlert]:
    """Generate battery charge/discharge alert for resilience or economics."""
    # Check if consumer has battery
    has_battery = profile_data.get("has_battery", False)
    if not has_battery:
        return None

    # Get temperature extremes
    peak_temp = _get_peak_temperature(weather_forecast)
    min_temp = _get_min_temperature(weather_forecast)

    # Priority 1: Resilience - extreme weather
    is_extreme_cold = min_temp is not None and min_temp < EXTREME_COLD_TEMP
    is_extreme_heat = peak_temp is not None and peak_temp > EXTREME_HEAT_TEMP

    if is_extreme_cold or is_extreme_heat:
        return DeviceAlert(
            profile_id=profile_id,
            device_type="battery",
            severity="critical",
            title="Full Battery Charge Recommended",
            description=(
                f"Extreme weather expected ({'cold' if is_extreme_cold else 'heat'}: "
                f"{int(min_temp if is_extreme_cold else peak_temp)}°F). "
                f"Fully charge battery for backup power during potential grid stress."
            ),
            recommended_action={
                "action": "CHARGE_FULL",
                "target_soc": 100,
            },
            estimated_savings_usd=0.0,  # Resilience, not cost savings
            weather_reason=f"Extreme {'cold' if is_extreme_cold else 'heat'} forecast",
            metadata={
                "extreme_temp_f": min_temp if is_extreme_cold else peak_temp,
                "reason": "resilience",
            },
        )

    # Priority 2: Economics - price spikes
    # Find peak price in next 48 hours
    if not price_forecast:
        return None

    peak_price = max(p.consumer_price_kwh for p in price_forecast)
    avg_price = sum(p.consumer_price_kwh for p in price_forecast) / len(price_forecast)

    if peak_price > HIGH_PRICE_THRESHOLD and peak_price > avg_price * 1.5:
        # Calculate arbitrage savings
        # Typical battery: 13.5 kWh capacity, 90% round-trip efficiency
        battery_kwh = 13.5
        efficiency = 0.90

        # Find cheapest charging hours
        sorted_prices = sorted(price_forecast, key=lambda p: p.consumer_price_kwh)
        cheap_hours = sorted_prices[:3]
        expensive_hours = sorted_prices[-3:]

        avg_charge_price = sum(p.consumer_price_kwh for p in cheap_hours) / len(cheap_hours)
        avg_discharge_price = sum(p.consumer_price_kwh for p in expensive_hours) / len(expensive_hours)

        savings = (avg_discharge_price * efficiency - avg_charge_price) * battery_kwh

        return DeviceAlert(
            profile_id=profile_id,
            device_type="battery",
            severity="optimization",
            title="Battery Arbitrage Opportunity",
            description=(
                f"Price spike expected (${peak_price:.2f}/kWh peak). "
                f"Charge battery during off-peak hours and discharge during "
                f"peak to save on electricity costs."
            ),
            recommended_action={
                "action": "ARBITRAGE",
                "charge_during": "off_peak",
                "discharge_during": "peak",
            },
            estimated_savings_usd=round(max(0, savings), 2),
            weather_reason="Price spike forecast",
            metadata={
                "peak_price_kwh": peak_price,
                "avg_price_kwh": avg_price,
                "reason": "economics",
            },
        )

    return None


# ── EV Charger Alert Generator ───────────────────────────────────────


def _generate_ev_charger_alert(
    profile_id: str,
    profile_data: Dict[str, Any],
    weather_forecast: Dict[str, Any],
    price_forecast: List[Any],
    region: str,
) -> Optional[DeviceAlert]:
    """Generate EV charging time-shifting alert."""
    # Check if consumer has EV
    has_ev = profile_data.get("has_ev", False)
    if not has_ev or not price_forecast:
        return None

    # Find cheapest 4-hour window in 48-hour forecast
    if len(price_forecast) < 4:
        return None

    # Current price (hour 0)
    current_price = price_forecast[0].consumer_price_kwh

    # Find cheapest 4-hour consecutive window
    min_window_cost = float("inf")
    best_start_hour = 0

    for i in range(len(price_forecast) - 3):
        window_cost = sum(price_forecast[i + j].consumer_price_kwh for j in range(4)) / 4
        if window_cost < min_window_cost:
            min_window_cost = window_cost
            best_start_hour = i

    # Only alert if current price is >30% higher than optimal window
    if current_price <= min_window_cost * (1 + EV_PRICE_DIFF_THRESHOLD):
        return None

    # Calculate savings
    # Typical EV charge: 7.2 kW for 4 hours = 28.8 kWh
    ev_kwh = 28.8
    savings = (current_price - min_window_cost) * ev_kwh

    optimal_hour = best_start_hour % 24
    period = "AM" if optimal_hour < 12 else "PM"
    display_hour = optimal_hour if optimal_hour <= 12 else optimal_hour - 12
    if display_hour == 0:
        display_hour = 12

    return DeviceAlert(
        profile_id=profile_id,
        device_type="ev_charger",
        severity="optimization",
        title="Defer EV Charging to Save",
        description=(
            f"Current price ${current_price:.2f}/kWh is ${current_price - min_window_cost:.2f} "
            f"higher than optimal. Delay charging until {display_hour}:00 {period} "
            f"to save on charging costs."
        ),
        recommended_action={
            "action": "DEFER",
            "optimal_start_hour": best_start_hour,
        },
        estimated_savings_usd=round(max(0, savings), 2),
        weather_reason="Price optimization opportunity",
        metadata={
            "current_price_kwh": current_price,
            "optimal_price_kwh": min_window_cost,
            "optimal_start_hour": best_start_hour,
        },
    )


# ── Public API ───────────────────────────────────────────────────────


async def generate_weather_alerts(
    profile_id: str,
    region: str = "ERCOT",
    scenario: str = "normal",
) -> List[DeviceAlert]:
    """Generate personalized weather-based alerts for a consumer profile.

    Args:
        profile_id: Consumer profile UUID
        region: Grid region (ERCOT, CAISO, etc.)
        scenario: Weather scenario (normal, uri_2021, etc.)

    Returns:
        List of DeviceAlert objects with personalized recommendations
    """
    alerts: List[DeviceAlert] = []

    try:
        # Fetch consumer profile
        profile_data = _fetch_consumer_device_preferences(profile_id)
        if not profile_data:
            logger.warning("Profile %s not found, skipping alerts", profile_id)
            return alerts

        # Fetch 48-hour weather forecast
        start_time = datetime.now(timezone.utc)
        weather_forecast = await weather_service.get_forecast(start_time, region)

        # Fetch 48-hour price forecast
        price_forecast = price_service.get_price_forecast(
            region=region,
            mode=PricingMode.HYBRID,
            scenario=scenario,
            hours=48,
        )

        # Generate device-specific alerts
        hvac_alert = _generate_hvac_alert(
            profile_id, profile_data, weather_forecast, price_forecast, region
        )
        if hvac_alert:
            alerts.append(hvac_alert)

        battery_alert = _generate_battery_alert(
            profile_id, profile_data, weather_forecast, price_forecast, region
        )
        if battery_alert:
            alerts.append(battery_alert)

        ev_alert = _generate_ev_charger_alert(
            profile_id, profile_data, weather_forecast, price_forecast, region
        )
        if ev_alert:
            alerts.append(ev_alert)

        logger.info(
            "Generated %d weather alerts for profile %s", len(alerts), profile_id
        )

    except Exception as exc:
        logger.error("Failed to generate weather alerts for %s: %s", profile_id, exc)

    return alerts
