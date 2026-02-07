/**
 * POST /api/simulation/respond
 *
 * Accept or decline a recommendation.
 * Sends iOS push confirmation via ntfy.
 * If accepted AND household is linked to Enode, also adjusts real thermostat.
 *
 * Body: { recommendationId: string, action: "ACCEPT" | "DECLINE" }
 */
import { NextRequest, NextResponse } from "next/server";
import {
  acceptRecommendation,
  declineRecommendation,
} from "@/lib/simulation";
import { controlHvac } from "@/lib/enode";
import { sendPushNotification } from "@/lib/notify";

export async function POST(req: NextRequest) {
  try {
    const { recommendationId, action } = await req.json();

    if (!recommendationId || !["ACCEPT", "DECLINE"].includes(action)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Required: recommendationId and action ("ACCEPT" or "DECLINE")',
        },
        { status: 400 }
      );
    }

    if (action === "DECLINE") {
      const result = declineRecommendation(recommendationId);

      // Push confirmation
      sendPushNotification({
        title: "Recommendation Declined",
        message: `No changes made to your thermostat. Current setpoint: ${result.household.hvac.setpoint}°C.`,
        priority: 2,
        tags: ["x"],
      });

      return NextResponse.json({ ok: true, ...result });
    }

    // Accept
    const result = acceptRecommendation(recommendationId);

    // Push confirmation
    sendPushNotification({
      title: "✅ Thermostat Adjusted",
      message:
        `Your thermostat has been set to ${result.recommendation.recommendedSetpoint}°C.\n` +
        `You earned +${result.recommendation.estimatedCredits} resilience credits!\n` +
        `Total credits: ${result.household.credits}`,
      priority: 3,
      tags: ["white_check_mark", "thermometer"],
    });

    // If backed by a real Enode device, also send the command
    if (result.needsEnodeCall && result.household.enodeHvacId) {
      try {
        const enodeResult = await controlHvac(
          result.household.enodeHvacId,
          {
            mode: result.household.hvac.mode,
            heatSetpoint: result.recommendation.recommendedSetpoint,
          }
        );
        return NextResponse.json({
          ok: true,
          ...result,
          enodeAction: enodeResult,
          enodeSynced: true,
        });
      } catch (enodeErr) {
        const msg =
          enodeErr instanceof Error ? enodeErr.message : String(enodeErr);
        return NextResponse.json({
          ok: true,
          ...result,
          enodeSynced: false,
          enodeError: msg,
        });
      }
    }

    return NextResponse.json({ ok: true, ...result, enodeSynced: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
