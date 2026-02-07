"""Test ntfy notification manually"""
import asyncio
import httpx

NTFY_SERVER = "https://ntfy.sh"
NTFY_TOPIC = "blackout-test-alerts"  # Change this to match your topic

async def send_test_notification():
    """Send a test notification to verify ntfy is working."""
    notification = {
        "title": "🧪 Test Alert",
        "message": (
            "This is a test notification from Blackout.\n\n"
            "If you see this on your iOS device, ntfy is working!\n\n"
            "Next step: Subscribe to this topic in the ntfy app:\n"
            f"Topic: {NTFY_TOPIC}"
        ),
        "priority": 4,
        "tags": ["white_check_mark", "test_tube"],
        "actions": [
            {
                "action": "view",
                "label": "✓ Test Accept",
                "url": "http://localhost:3000/dashboard",
                "clear": True,
            },
            {
                "action": "view",
                "label": "✗ Test Decline",
                "url": "http://localhost:3000/dashboard",
                "clear": True,
            },
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{NTFY_SERVER}/{NTFY_TOPIC}",
                json=notification,
            )
            resp.raise_for_status()
            print(f"✅ Test notification sent successfully to topic: {NTFY_TOPIC}")
            print(f"📱 Check your iOS device (ntfy app)")
            print(f"\n🔗 Subscribe to topic in ntfy app: {NTFY_TOPIC}")
            return True
    except Exception as exc:
        print(f"❌ Failed to send notification: {exc}")
        return False


if __name__ == "__main__":
    print("Sending test notification...")
    asyncio.run(send_test_notification())
