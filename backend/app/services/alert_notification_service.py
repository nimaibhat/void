"""Alert Notification Service — ntfy push notifications for weather alerts.

Sends personalized alert notifications to consumer mobile devices via ntfy.sh
with accept/decline action buttons.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx
import requests

from app.config import settings

logger = logging.getLogger("blackout.alert_notifications")

# ntfy.sh public server (can be configured to use self-hosted)
NTFY_SERVER = "https://ntfy.sh"


# ── Helper Functions ─────────────────────────────────────────────────


def _get_consumer_ntfy_topic(profile_id: str) -> Optional[str]:
    """Fetch consumer's ntfy topic from Supabase."""
    url = settings.supabase_url
    key = settings.supabase_anon_key
    if not url or not key:
        return None

    try:
        resp = requests.get(
            f"{url}/rest/v1/consumer_profiles",
            params={"id": f"eq.{profile_id}", "select": "ntfy_topic"},
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=5,
        )
        resp.raise_for_status()
        rows = resp.json()
        if not rows:
            return None
        return rows[0].get("ntfy_topic")
    except Exception as exc:
        logger.warning("Failed to fetch ntfy topic for profile %s: %s", profile_id, exc)
        return None


def _format_alert_notification(alert: Dict[str, Any]) -> Dict[str, Any]:
    """Format alert data into ntfy notification payload (matches simulation style)."""
    # Extract alert details
    title = alert.get("title", "Grid Alert")
    description = alert.get("description", "")
    severity = alert.get("severity", "info")
    alert_id = alert.get("id")
    alert_type = alert.get("alert_type", "")
    metadata = alert.get("metadata", {})
    estimated_savings = metadata.get("estimated_savings_usd", 0)
    recommended_action = metadata.get("recommended_action", {})

    # Map severity to ntfy priority (matches simulation)
    priority_map = {
        "critical": 5,
        "warning": 4,
        "optimization": 3,
        "info": 2,
    }
    priority = priority_map.get(severity, 3)

    # Build message in simulation style
    message = f"{description}\n\n"

    # Add device-specific adjustment preview (like simulation)
    if "hvac" in alert_type:
        typical_setpoint = metadata.get("typical_setpoint", "??")
        recommended_setpoint = (
            recommended_action.get("coolSetpoint")
            or recommended_action.get("heatSetpoint")
            or "??"
        )
        message += f"🌡️ Current: {typical_setpoint}°F → Recommended: {recommended_setpoint}°F\n"
    elif "ev" in alert_type or "battery" in alert_type:
        # For EV/battery, show action description
        action_desc = metadata.get("action_description", "Adjust device timing")
        message += f"⚡ Action: {action_desc}\n"

    # Add savings in simulation format
    if estimated_savings > 0:
        message += f"💰 Save ~${estimated_savings:.2f} → RLUSD"

    # Create accept/decline action buttons (simulation style)
    base_url = settings.api_base_url or "http://localhost:3000"
    actions = []

    if alert_id:
        actions = [
            {
                "action": "view",
                "label": "✓ Accept",
                "url": f"{base_url}/api/alerts/respond?id={alert_id}&action=ACCEPT",
                "clear": True,
            },
            {
                "action": "view",
                "label": "✗ Decline",
                "url": f"{base_url}/api/alerts/respond?id={alert_id}&action=DECLINE",
                "clear": True,
            },
        ]

    # Select appropriate tags based on alert type (matches simulation)
    tag_map = {
        "weather_hvac": ["thermometer", "fire"],
        "weather_battery": ["battery", "zap"],
        "weather_ev": ["car", "zap"],
    }
    tags = tag_map.get(alert_type, ["warning"])

    return {
        "title": title,
        "message": message,
        "priority": priority,
        "actions": actions,
        "tags": tags,
        "click": f"{base_url}/dashboard",  # Tapping notification body opens dashboard
    }


async def send_weather_alert_notification(
    profile_id: str,
    alert_data: Dict[str, Any],
    ntfy_topic: Optional[str] = None,
) -> bool:
    """Send a single weather alert notification to a consumer.

    Args:
        profile_id: Consumer profile UUID
        alert_data: Alert dictionary with title, description, metadata
        ntfy_topic: Optional override for ntfy topic (fetched from DB if not provided)

    Returns:
        True if notification sent successfully, False otherwise
    """
    # Get ntfy topic if not provided
    if not ntfy_topic:
        ntfy_topic = _get_consumer_ntfy_topic(profile_id)

    if not ntfy_topic:
        logger.warning("No ntfy topic configured for profile %s", profile_id)
        return False

    # Format notification
    notification = _format_alert_notification(alert_data)

    # Send to ntfy
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{NTFY_SERVER}/{ntfy_topic}",
                json=notification,
            )
            resp.raise_for_status()
            logger.info("Sent notification to topic %s for profile %s", ntfy_topic, profile_id)
            return True
    except Exception as exc:
        logger.error(
            "Failed to send notification to topic %s: %s",
            ntfy_topic,
            exc,
        )
        return False


async def broadcast_weather_alerts(alerts: List[Dict[str, Any]]) -> Dict[str, int]:
    """Broadcast weather alerts to all affected consumers.

    Args:
        alerts: List of alert dictionaries with profile_id and alert data

    Returns:
        Dictionary with success and failure counts
    """
    success_count = 0
    failure_count = 0

    for alert in alerts:
        profile_id = alert.get("profile_id")
        if not profile_id:
            # Skip non-personalized alerts
            continue

        # Only send weather alerts (personalized)
        alert_type = alert.get("alert_type", "")
        if not alert_type.startswith("weather_"):
            continue

        success = await send_weather_alert_notification(profile_id, alert)
        if success:
            success_count += 1
        else:
            failure_count += 1

    logger.info(
        "Broadcast complete: %d sent, %d failed",
        success_count,
        failure_count,
    )

    return {
        "success": success_count,
        "failed": failure_count,
    }


async def send_confirmation_notification(
    profile_id: str,
    alert_title: str,
    action_taken: str,
    success: bool,
    message: Optional[str] = None,
    device_type: Optional[str] = None,
    savings_added: float = 0,
    savings_pending: float = 0,
    payout_threshold: float = 10.0,
) -> bool:
    """Send a confirmation notification after alert response (matches simulation style).

    Args:
        profile_id: Consumer profile UUID
        alert_title: Original alert title
        action_taken: "ACCEPT" or "DECLINE"
        success: Whether the action was successful
        message: Optional custom message
        device_type: Device type (hvac, battery, ev_charger)
        savings_added: Savings added this action
        savings_pending: Total pending savings
        payout_threshold: Threshold for XRPL payout

    Returns:
        True if notification sent successfully
    """
    ntfy_topic = _get_consumer_ntfy_topic(profile_id)
    if not ntfy_topic:
        return False

    if action_taken == "ACCEPT":
        if success:
            # Match simulation success format
            title = "✅ Device Adjusted"

            device_name = {
                "hvac": "thermostat",
                "battery": "battery",
                "ev_charger": "EV charger",
            }.get(device_type, "device")

            default_message = (
                f"Your {device_name} has been adjusted.\n"
                f"You earned ${savings_added:.2f} energy savings!\n"
                f"💵 Pending: ${savings_pending:.2f}"
            )

            # Add payout status (like simulation)
            if savings_pending >= payout_threshold:
                default_message += f"\n🚀 Payout threshold reached! Sending RLUSD..."
            else:
                remaining = payout_threshold - savings_pending
                default_message += f"\n📊 ${remaining:.2f} more until RLUSD payout"

            priority = 3
            tags = ["white_check_mark", "thermometer" if device_type == "hvac" else "zap"]
        else:
            title = "✗ Device Control Failed"
            default_message = f"Failed to adjust your device for: {alert_title}\nPlease try again or contact support."
            priority = 4
            tags = ["x"]
    else:  # DECLINE
        # Match simulation decline format
        title = "Recommendation Declined"
        default_message = "No changes made to your device."
        priority = 2
        tags = ["x"]

    notification = {
        "title": title,
        "message": message or default_message,
        "priority": priority,
        "tags": tags,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{NTFY_SERVER}/{ntfy_topic}",
                json=notification,
            )
            resp.raise_for_status()
            logger.info("Sent confirmation notification to profile %s", profile_id)
            return True
    except Exception as exc:
        logger.error("Failed to send confirmation notification: %s", exc)
        return False


async def send_payout_notification(
    profile_id: str,
    amount_usd: float,
    tx_hash: str,
    total_paid: Optional[float] = None,
) -> bool:
    """Send a notification when XRPL payout is sent (matches simulation style).

    Args:
        profile_id: Consumer profile UUID
        amount_usd: Amount paid in USD
        tx_hash: XRPL transaction hash
        total_paid: Total amount paid to date (optional)

    Returns:
        True if notification sent successfully
    """
    ntfy_topic = _get_consumer_ntfy_topic(profile_id)
    if not ntfy_topic:
        return False

    # Match simulation payout format exactly
    message = (
        f"${amount_usd:.2f} RLUSD → your wallet!\n"
        f"TX: {tx_hash[:16]}…\n"
    )

    # Add total earned if available
    if total_paid is not None:
        message += f"Total earned: ${total_paid:.2f} RLUSD"

    notification = {
        "title": "💰 RLUSD Payout Sent!",
        "message": message,
        "priority": 4,
        "tags": ["moneybag", "rocket"],
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{NTFY_SERVER}/{ntfy_topic}",
                json=notification,
            )
            resp.raise_for_status()
            logger.info("Sent payout notification to profile %s: $%s", profile_id, amount_usd)
            return True
    except Exception as exc:
        logger.error("Failed to send payout notification: %s", exc)
        return False
