/**
<<<<<<< HEAD
 * GET /api/xrpl/status?householdId=hh-martinez
 *
 * Returns XRPL wallet status for a household:
 *   - RLUSD balance (on-chain)
 *   - XRP balance (on-chain)
 *   - Recent RLUSD transactions
 *   - Pending / paid savings from simulation state
=======
 * GET /api/xrpl/status?address=rXXX  — Get RLUSD balance & recent txs
 * GET /api/xrpl/status?householdId=hh-martinez — Same, using household wallet
 *
 * Shows the user's XRPL balance and recent RLUSD transactions.
>>>>>>> 44f8655ddc1f10d7dfba2ef22d4f4309146ea770
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getRLUSDBalance,
  getXRPBalance,
  getRecentTransactions,
<<<<<<< HEAD
=======
  getIssuerAddress,
>>>>>>> 44f8655ddc1f10d7dfba2ef22d4f4309146ea770
} from "@/lib/xrpl";
import { getHousehold } from "@/lib/simulation";

export async function GET(req: NextRequest) {
  try {
<<<<<<< HEAD
    const householdId = req.nextUrl.searchParams.get("householdId");
    if (!householdId) {
      return NextResponse.json(
        { ok: false, error: "householdId query param is required." },
=======
    let address = req.nextUrl.searchParams.get("address");
    const householdId = req.nextUrl.searchParams.get("householdId");

    // Resolve address from household if not provided directly
    if (!address && householdId) {
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
          connected: false,
          message: "No XRPL wallet linked to this household.",
          household: {
            id: hh.id,
            name: hh.name,
            savingsPending: hh.savingsUSD_pending,
            savingsPaid: hh.savingsUSD_paid,
            payouts: hh.payouts,
          },
        });
      }
      address = hh.xrplWallet.address;
    }

    if (!address) {
      return NextResponse.json(
        { ok: false, error: "Provide address or householdId query param." },
>>>>>>> 44f8655ddc1f10d7dfba2ef22d4f4309146ea770
        { status: 400 }
      );
    }

<<<<<<< HEAD
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
=======
    const [rlusdBalance, xrpBalance, recentTxs] = await Promise.all([
      getRLUSDBalance(address),
      getXRPBalance(address),
      getRecentTransactions(address),
    ]);

    const hh = householdId ? getHousehold(householdId) : null;

    return NextResponse.json({
      ok: true,
      connected: true,
      address,
      issuer: getIssuerAddress(),
      balances: {
        RLUSD: rlusdBalance,
        XRP: xrpBalance,
      },
      recentTransactions: recentTxs,
      household: hh
        ? {
            id: hh.id,
            name: hh.name,
            savingsPending: +hh.savingsUSD_pending.toFixed(4),
            savingsPaid: +hh.savingsUSD_paid.toFixed(2),
            trustLineCreated: hh.xrplWallet?.trustLineCreated ?? false,
            payouts: hh.payouts,
            sessions: hh.savingSessions,
          }
        : null,
>>>>>>> 44f8655ddc1f10d7dfba2ef22d4f4309146ea770
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
