/**
 * GET /api/simulation/respond-quick?id=rec-xxx&action=ACCEPT
 *
 * Lightweight endpoint called directly by ntfy action buttons
 * from the iOS notification (no browser, no POST body needed).
 * After processing, sends a confirmation push notification back.
 * Also triggers XRPL payout if savings threshold is met.
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
    const hh = result.household;

    // Send confirmation push with savings info
    await sendPushNotification({
      title: "✅ Thermostat Adjusted!",
      message:
        `Set to ${result.recommendation.recommendedSetpoint}°C\n` +
        `+${result.recommendation.estimatedCredits} credits earned\n` +
        `💵 +$${result.recommendation.estimatedSavingsUSD.toFixed(2)} savings` +
        (hh.savingsUSD_pending >= PAYOUT_THRESHOLD_USD
          ? ` — RLUSD payout sending!`
          : ` (total pending: $${hh.savingsUSD_pending.toFixed(2)})`),
      priority: 3,
      tags: ["white_check_mark", "thermometer"],
      noAttach: true,
    });

    // If backed by a real Enode device, also send the command
    if (result.needsEnodeCall && hh.enodeHvacId) {
      try {
        await controlHvac(hh.enodeHvacId, {
          mode: hh.hvac.mode,
          heatSetpoint: result.recommendation.recommendedSetpoint,
        });
      } catch {
        /* Enode call is best-effort */
      }
    }

    // ── Auto-payout RLUSD if threshold reached ──────────────
    if (isPayoutReady(hh.id)) {
      try {
        const payoutAmount = +hh.savingsUSD_pending.toFixed(2);
        const txResult = await sendRLUSDPayout({
          destination: hh.xrplWallet!.address,
          amount: payoutAmount.toFixed(2),
        });
        checkAndRecordPayout(hh.id, txResult.hash);

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
        console.error("[XRPL] Quick-respond payout failed:", payoutErr);
      }
    }

    return NextResponse.json({ ok: true, status: "ACCEPTED" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

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
