/**
 * POST /api/xrpl/payout
 *
 * Manually trigger an RLUSD payout for a household.
 * Checks if pending savings >= threshold, sends RLUSD on XRPL, records payout.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getHousehold,
  checkAndRecordPayout,
  PAYOUT_THRESHOLD_USD,
} from "@/lib/simulation";
import { sendRLUSDPayout } from "@/lib/xrpl";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { householdId, address, seed, amount } = body;

    // New format: direct payout with address, seed, and amount
    if (address && amount) {
      // Send RLUSD on XRPL
      const txResult = await sendRLUSDPayout({
        destination: address,
        amount: amount,
      });

      const txHash = txResult.result.hash ?? "unknown";

      return NextResponse.json({
        ok: true,
        message: `Payout of $${amount} RLUSD sent.`,
        txHash,
      });
    }

    // Old format: householdId (for backwards compatibility)
    if (!householdId) {
      return NextResponse.json(
        { ok: false, error: "householdId or address+amount is required." },
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
          error: "No XRPL wallet with trust line. Complete XRPL setup first.",
        },
        { status: 400 }
      );
    }

    if (hh.savingsUSD_pending < PAYOUT_THRESHOLD_USD) {
      return NextResponse.json({
        ok: true,
        message: `No payout triggered. Pending: $${hh.savingsUSD_pending.toFixed(2)}, threshold: $${PAYOUT_THRESHOLD_USD.toFixed(2)}.`,
        savingsPending: hh.savingsUSD_pending,
        savingsPaid: hh.savingsUSD_paid,
      });
    }

    // Send RLUSD on XRPL
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
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
