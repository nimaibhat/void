/**
 * POST /api/xrpl/payout
 *
 * Manually trigger an RLUSD payout for a household.
<<<<<<< HEAD
 * Checks if pending savings >= threshold, sends RLUSD on XRPL, records payout.
 */
import { NextRequest, NextResponse } from "next/server";
=======
 * Normally this happens automatically when savings >= threshold after ACCEPT.
 * This endpoint exists for manual testing / demo purposes.
 *
 * Body: { householdId: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { sendRLUSDPayout } from "@/lib/xrpl";
>>>>>>> 44f8655ddc1f10d7dfba2ef22d4f4309146ea770
import {
  getHousehold,
  checkAndRecordPayout,
  PAYOUT_THRESHOLD_USD,
} from "@/lib/simulation";
<<<<<<< HEAD
import { sendRLUSDPayout } from "@/lib/xrpl";
=======
import { sendPushNotification } from "@/lib/notify";
>>>>>>> 44f8655ddc1f10d7dfba2ef22d4f4309146ea770

export async function POST(req: NextRequest) {
  try {
    const { householdId } = await req.json();
<<<<<<< HEAD

=======
>>>>>>> 44f8655ddc1f10d7dfba2ef22d4f4309146ea770
    if (!householdId) {
      return NextResponse.json(
        { ok: false, error: "householdId is required." },
        { status: 400 }
      );
    }

    const hh = getHousehold(householdId);
    if (!hh) {
      return NextResponse.json(
        { ok: false, error: `Household ${householdId} not found.` },
        { status: 404 }
      );
    }

    if (!hh.xrplWallet?.trustLineCreated) {
      return NextResponse.json(
        {
          ok: false,
<<<<<<< HEAD
          error: "No XRPL wallet with trust line. Complete XRPL setup first.",
=======
          error:
            "XRPL wallet not set up or trust line not created. Run /api/xrpl/setup first.",
>>>>>>> 44f8655ddc1f10d7dfba2ef22d4f4309146ea770
        },
        { status: 400 }
      );
    }

    if (hh.savingsUSD_pending < PAYOUT_THRESHOLD_USD) {
      return NextResponse.json({
<<<<<<< HEAD
        ok: true,
        message: `No payout triggered. Pending: $${hh.savingsUSD_pending.toFixed(2)}, threshold: $${PAYOUT_THRESHOLD_USD.toFixed(2)}.`,
        savingsPending: hh.savingsUSD_pending,
        savingsPaid: hh.savingsUSD_paid,
=======
        ok: false,
        error: `Pending savings ($${hh.savingsUSD_pending.toFixed(
          2
        )}) below threshold ($${PAYOUT_THRESHOLD_USD.toFixed(2)}). ` +
          `Accept more recommendations to accumulate savings.`,
        savingsPending: +hh.savingsUSD_pending.toFixed(4),
        threshold: PAYOUT_THRESHOLD_USD,
>>>>>>> 44f8655ddc1f10d7dfba2ef22d4f4309146ea770
      });
    }

    // Send RLUSD on XRPL
<<<<<<< HEAD
    const payoutAmount = hh.savingsUSD_pending.toFixed(2);
    const txResult = await sendRLUSDPayout({
      destination: hh.xrplWallet.address,
      amount: payoutAmount,
    });

    const txHash = txResult.result.hash ?? "unknown";

    // Record payout in simulation state
    const record = checkAndRecordPayout(householdId, txHash);

    return NextResponse.json({
      ok: true,
      message: `Payout of $${payoutAmount} RLUSD sent.`,
      payout: record,
      txHash,
      savingsPending: hh.savingsUSD_pending,
      savingsPaid: hh.savingsUSD_paid,
=======
    const payoutAmount = +hh.savingsUSD_pending.toFixed(2);
    const txResult = await sendRLUSDPayout({
      destination: hh.xrplWallet.address,
      amount: payoutAmount.toFixed(2),
    });

    // Record payout in simulation state
    const record = checkAndRecordPayout(householdId, txResult.hash);

    // Send push notification about payout
    await sendPushNotification({
      title: "💰 RLUSD Payout Sent!",
      message:
        `$${payoutAmount.toFixed(2)} RLUSD has been sent to your wallet!\n` +
        `TX: ${txResult.hash.slice(0, 12)}…\n` +
        `Total paid out: $${hh.savingsUSD_paid.toFixed(2)}`,
      priority: 4,
      tags: ["moneybag", "rocket"],
      noAttach: true,
    });

    return NextResponse.json({
      ok: true,
      payout: record,
      xrplTx: txResult,
      household: {
        id: hh.id,
        name: hh.name,
        savingsPending: +hh.savingsUSD_pending.toFixed(4),
        savingsPaid: +hh.savingsUSD_paid.toFixed(2),
      },
>>>>>>> 44f8655ddc1f10d7dfba2ef22d4f4309146ea770
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
