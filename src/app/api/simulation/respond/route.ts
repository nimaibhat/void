/**
 * POST /api/simulation/respond
 *
 * Accept or decline a recommendation.
 * Sends iOS push confirmation via ntfy.
 * If accepted AND household is linked to Enode, also adjusts real thermostat.
 * If accepted AND savings threshold met AND XRPL wallet linked, sends RLUSD payout.
 *
 * Body: { recommendationId: string, action: "ACCEPT" | "DECLINE" }
 */
import { NextRequest, NextResponse } from "next/server";
import {
  acceptRecommendation,
  declineRecommendation,
  isPayoutReady,
  checkAndRecordPayout,
  PAYOUT_THRESHOLD_USD,
} from "@/lib/simulation";
import { controlHvac } from "@/lib/enode";
import { sendPushNotification } from "@/lib/notify";
import { sendRLUSDPayout } from "@/lib/xrpl";

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
    const hh = result.household;

    // Push confirmation with savings info
    sendPushNotification({
      title: "✅ Thermostat Adjusted",
      message:
        `Your thermostat has been set to ${result.recommendation.recommendedSetpoint}°C.\n` +
        `You earned +${result.recommendation.estimatedCredits} resilience credits!\n` +
        `💵 Estimated savings: $${result.recommendation.estimatedSavingsUSD.toFixed(2)} ` +
        `(pending: $${hh.savingsUSD_pending.toFixed(2)})` +
        (hh.savingsUSD_pending >= PAYOUT_THRESHOLD_USD
          ? `\n🚀 Payout threshold reached! Sending RLUSD...`
          : `\n📊 $${(PAYOUT_THRESHOLD_USD - hh.savingsUSD_pending).toFixed(2)} more until RLUSD payout`),
      priority: 3,
      tags: ["white_check_mark", "thermometer"],
    });

    // If backed by a real Enode device, also send the command
    let enodeSynced = false;
    let enodeError: string | undefined;
    if (result.needsEnodeCall && hh.enodeHvacId) {
      try {
        await controlHvac(hh.enodeHvacId, {
          mode: hh.hvac.mode,
          heatSetpoint: result.recommendation.recommendedSetpoint,
        });
        enodeSynced = true;
      } catch (err) {
        enodeError = err instanceof Error ? err.message : String(err);
      }
    }

    // ── Auto-payout RLUSD if threshold reached ──────────────
    let payoutResult = null;
    if (isPayoutReady(hh.id)) {
      try {
        const payoutAmount = +hh.savingsUSD_pending.toFixed(2);
        const txResult = await sendRLUSDPayout({
          destination: hh.xrplWallet!.address,
          amount: payoutAmount.toFixed(2),
        });

        payoutResult = checkAndRecordPayout(hh.id, txResult.hash);

        // Send payout notification
        await sendPushNotification({
          title: "💰 RLUSD Payout Sent!",
          message:
            `$${payoutAmount.toFixed(2)} RLUSD → your wallet!\n` +
            `TX: ${txResult.hash.slice(0, 16)}…\n` +
            `Total earned: $${hh.savingsUSD_paid.toFixed(2)} RLUSD`,
          priority: 4,
          tags: ["moneybag", "rocket"],
          noAttach: true,
        });
      } catch (payoutErr) {
        console.error("[XRPL] Auto-payout failed:", payoutErr);
      }
    }

    return NextResponse.json({
      ok: true,
      ...result,
      enodeSynced,
      enodeError,
      savings: {
        thisEvent: result.recommendation.estimatedSavingsUSD,
        pending: +hh.savingsUSD_pending.toFixed(4),
        paid: +hh.savingsUSD_paid.toFixed(2),
        threshold: PAYOUT_THRESHOLD_USD,
        payoutTriggered: !!payoutResult,
      },
      payout: payoutResult,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
