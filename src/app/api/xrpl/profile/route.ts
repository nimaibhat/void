/**
 * GET /api/xrpl/profile?profileId=xxx
 * POST /api/xrpl/profile
 *
 * Load and save XRPL wallet data for a consumer profile
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getProfileXRPLData,
  saveProfileXRPLWallet,
  markProfileTrustLineCreated,
  updateProfileSavings,
  recordProfilePayout,
  getProfilePayouts,
} from "@/lib/dashboardPersistence";

export async function GET(req: NextRequest) {
  try {
    const profileId = req.nextUrl.searchParams.get("profileId");
    if (!profileId) {
      return NextResponse.json(
        { ok: false, error: "profileId is required" },
        { status: 400 }
      );
    }

    console.log("[xrpl/profile] Loading wallet for profile:", profileId);

    const wallet = await getProfileXRPLData(profileId);
    const payouts = await getProfilePayouts(profileId);

    console.log("[xrpl/profile] Wallet loaded:", wallet ? "found" : "not found");

    return NextResponse.json({
      ok: true,
      wallet,
      payouts: payouts.map((p) => ({
        txHash: p.txHash,
        amount: p.amount,
        timestamp: p.timestamp,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "";
    console.error("[xrpl/profile] GET error:", message, stack);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, profileId } = body;

    console.log("[xrpl/profile] POST action:", action, "profileId:", profileId);

    if (!profileId) {
      return NextResponse.json(
        { ok: false, error: "profileId is required" },
        { status: 400 }
      );
    }

    // Save wallet
    if (action === "saveWallet") {
      const { address, seed } = body;
      if (!address || !seed) {
        return NextResponse.json(
          { ok: false, error: "address and seed are required" },
          { status: 400 }
        );
      }
      console.log("[xrpl/profile] Saving wallet:", address);
      await saveProfileXRPLWallet(profileId, address, seed);
      return NextResponse.json({ ok: true });
    }

    // Mark trust line created
    if (action === "markTrustLine") {
      console.log("[xrpl/profile] Marking trust line created");
      await markProfileTrustLineCreated(profileId);
      return NextResponse.json({ ok: true });
    }

    // Update savings
    if (action === "updateSavings") {
      const { pendingDelta = 0, paidDelta = 0 } = body;
      console.log("[xrpl/profile] Updating savings:", { pendingDelta, paidDelta });
      await updateProfileSavings(profileId, pendingDelta, paidDelta);
      return NextResponse.json({ ok: true });
    }

    // Record payout
    if (action === "recordPayout") {
      const { amount, txHash } = body;
      if (!amount || !txHash) {
        return NextResponse.json(
          { ok: false, error: "amount and txHash are required" },
          { status: 400 }
        );
      }
      console.log("[xrpl/profile] Recording payout:", amount);
      await recordProfilePayout(profileId, amount, txHash);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { ok: false, error: "Invalid action" },
      { status: 400 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "";
    console.error("[xrpl/profile] POST error:", message, stack);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
