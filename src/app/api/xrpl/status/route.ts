/**
 * GET /api/xrpl/status?householdId=hh-martinez
 *
 * Returns XRPL wallet status for a household:
 *   - RLUSD balance (on-chain)
 *   - XRP balance (on-chain)
 *   - Recent RLUSD transactions
 *   - Pending / paid savings from simulation state
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getRLUSDBalance,
  getXRPBalance,
  getRecentTransactions,
} from "@/lib/xrpl";
import { getHousehold } from "@/lib/simulation";

export async function GET(req: NextRequest) {
  try {
    const householdId = req.nextUrl.searchParams.get("householdId");
    const address = req.nextUrl.searchParams.get("address");

    // Support both householdId (old) and address (new) formats
    if (address) {
      // New format: query by address
      const [rlusdBalance, xrpBalance, transactions] = await Promise.all([
        getRLUSDBalance(address),
        getXRPBalance(address),
        getRecentTransactions(address),
      ]);

      return NextResponse.json({
        ok: true,
        xrplAddress: address,
        balances: {
          RLUSD: rlusdBalance,
          XRP: xrpBalance,
        },
        transactions,
      });
    }

    if (!householdId) {
      return NextResponse.json(
        { ok: false, error: "householdId or address query param is required." },
        { status: 400 }
      );
    }

    // Old format: query by householdId (for backwards compatibility)
    const hh = getHousehold(householdId);
    if (!hh) {
      return NextResponse.json(
        { ok: false, error: `Household ${householdId} not found.` },
        { status: 404 }
      );
    }

    if (!hh.xrplWallet) {
      return NextResponse.json({
        ok: true,
        xrplAddress: null,
        rlusdBalance: 0,
        xrpBalance: 0,
        transactions: [],
        savingsPending: hh.savingsUSD_pending,
        savingsPaid: hh.savingsUSD_paid,
        payouts: hh.payouts,
      });
    }

    const [rlusdBalance, xrpBalance, transactions] = await Promise.all([
      getRLUSDBalance(hh.xrplWallet.address),
      getXRPBalance(hh.xrplWallet.address),
      getRecentTransactions(hh.xrplWallet.address),
    ]);

    return NextResponse.json({
      ok: true,
      xrplAddress: hh.xrplWallet.address,
      trustLineCreated: hh.xrplWallet.trustLineCreated,
      rlusdBalance: parseFloat(rlusdBalance),
      xrpBalance: parseFloat(xrpBalance),
      transactions,
      savingsPending: hh.savingsUSD_pending,
      savingsPaid: hh.savingsUSD_paid,
      payouts: hh.payouts,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
