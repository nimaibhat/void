/**
 * GET /api/simulation/respond-quick?id=rec-xxx&action=ACCEPT
 *
 * Lightweight endpoint called directly by ntfy action buttons
 * from the iOS notification (no browser, no POST body needed).
 * After processing, sends a confirmation push notification back.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  acceptRecommendation,
  declineRecommendation,
} from "@/lib/simulation";
import { controlHvac } from "@/lib/enode";
import { sendPushNotification } from "@/lib/notify";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const action = req.nextUrl.searchParams.get("action")?.toUpperCase();

  if (!id || !action || !["ACCEPT", "DECLINE"].includes(action)) {
    return NextResponse.json(
      { ok: false, error: "Missing id or action param" },
      { status: 400 }
    );
  }

  try {
    if (action === "DECLINE") {
      const result = declineRecommendation(id);

      // Send confirmation push (no image attachment for quick confirmations)
      await sendPushNotification({
        title: "Recommendation Declined",
        message: `No changes made. Your thermostat stays at ${result.household.hvac.setpoint}°C.`,
        priority: 2,
        tags: ["x"],
        noAttach: true,
      });

      return NextResponse.json({ ok: true, status: "DECLINED" });
    }

    // ACCEPT
    const result = acceptRecommendation(id);

    // Send confirmation push (no image attachment for quick confirmations)
    await sendPushNotification({
      title: "✅ Thermostat Adjusted!",
      message:
        `Set to ${result.recommendation.recommendedSetpoint}°C\n` +
        `+${result.recommendation.estimatedCredits} credits earned\n` +
        `Total: ${result.household.credits} credits`,
      priority: 3,
      tags: ["white_check_mark", "thermometer"],
      noAttach: true,
    });

    // If backed by a real Enode device, also send the command
    if (result.needsEnodeCall && result.household.enodeHvacId) {
      try {
        await controlHvac(result.household.enodeHvacId, {
          mode: result.household.hvac.mode,
          heatSetpoint: result.recommendation.recommendedSetpoint,
        });
      } catch {
        /* Enode call is best-effort */
      }
    }

    return NextResponse.json({ ok: true, status: "ACCEPTED" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Send error push so user knows something went wrong
    await sendPushNotification({
      title: "⚠️ Action Failed",
      message: message.includes("already")
        ? "This recommendation was already processed."
        : `Error: ${message}`,
      priority: 2,
      tags: ["warning"],
      noAttach: true,
    });

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
