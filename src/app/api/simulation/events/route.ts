/**
 * POST /api/simulation/events
 *
 * Trigger a grid event → generates recommendations →
 * sends iOS push notification with Accept / Decline action buttons.
 *
 * On iOS: long-press the notification to reveal the buttons.
 * Tapping a button opens a page that auto-processes the action
 * and shows confirmation — no extra taps needed.
 */
import { NextRequest, NextResponse } from "next/server";
import { triggerGridEvent } from "@/lib/simulation";
import type { EventType } from "@/lib/simulation";
import { sendPushNotification, getBaseUrl } from "@/lib/notify";

const VALID_TYPES: EventType[] = [
  "DEMAND_REDUCTION",
  "PRICE_SPIKE",
  "HEAT_WAVE",
  "COLD_SNAP",
  "RENEWABLE_SURPLUS",
];

const SEVERITY_PRIORITY: Record<string, 1 | 2 | 3 | 4 | 5> = {
  LOW: 2,
  MEDIUM: 3,
  HIGH: 4,
  CRITICAL: 5,
};

const EVENT_TAGS: Record<string, string[]> = {
  DEMAND_REDUCTION: ["zap", "warning"],
  PRICE_SPIKE: ["moneybag", "chart_with_upwards_trend"],
  HEAT_WAVE: ["fire", "thermometer"],
  COLD_SNAP: ["snowflake", "cold_face"],
  RENEWABLE_SURPLUS: ["seedling", "sun_with_face"],
};

export async function POST(req: NextRequest) {
  try {
    const { eventType } = await req.json();

    if (!eventType || !VALID_TYPES.includes(eventType)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Invalid eventType. Must be one of: ${VALID_TYPES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const result = triggerGridEvent(eventType);

    // Send push notification with action buttons
    const martinezRec = result.recommendations.find(
      (r) => r.householdId === "hh-martinez"
    );

    let pushSent = false;
    if (martinezRec) {
      const base = getBaseUrl();
      const acceptUrl = `${base}/simulation/respond?id=${martinezRec.id}&action=ACCEPT`;
      const declineUrl = `${base}/simulation/respond?id=${martinezRec.id}&action=DECLINE`;

      const message =
        `${martinezRec.reason}\n\n` +
        `🌡️ Current: ${martinezRec.currentSetpoint}°C → Recommended: ${martinezRec.recommendedSetpoint}°C\n` +
        `🏆 Earn +${martinezRec.estimatedCredits} resilience credits`;

      pushSent = await sendPushNotification({
        title: result.event.notificationTitle,
        message,
        priority: SEVERITY_PRIORITY[result.event.severity] ?? 3,
        tags: EVENT_TAGS[eventType] ?? [],
        clickUrl: acceptUrl, // Tapping notification body → opens accept page
        actions: [
          {
            action: "view",
            label: `✓ Accept (${martinezRec.recommendedSetpoint}°C)`,
            url: acceptUrl,
            clear: true,
          },
          {
            action: "view",
            label: "✗ Decline",
            url: declineUrl,
            clear: true,
          },
        ],
      });
    }

    return NextResponse.json({ ok: true, ...result, pushSent });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
