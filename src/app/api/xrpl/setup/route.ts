/**
 * POST /api/xrpl/setup
 *
 * One-time setup for XRPL integration:
 *   1. { action: "fund" }        — Create & fund a Testnet wallet via faucet
 *   2. { action: "link", householdId, address, seed } — Link wallet to household
 *   3. { action: "trustline", householdId } — Create RLUSD trust line
 *   4. { action: "info" } — Get program wallet info
 */
import { NextRequest, NextResponse } from "next/server";
import {
  fundTestnetWallet,
  createRLUSDTrustLine,
  getIssuerAddress,
  getProgramWallet,
} from "@/lib/xrpl";
import {
  linkXrplWallet,
  markTrustLineCreated,
  getHousehold,
} from "@/lib/simulation";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    /* ── Fund a new Testnet wallet ─────────────────── */
    if (action === "fund") {
      const result = await fundTestnetWallet();
      return NextResponse.json({
        ok: true,
        address: result.address,
        seed: result.seed,
        balance: result.balance,
        message:
          "Testnet wallet funded. Next: link it to a household, then create a trust line.",
      });
    }

    /* ── Link wallet to a household ─────────────────── */
    if (action === "link") {
      const { householdId, address, seed } = body;
      if (!householdId || !address || !seed) {
        return NextResponse.json(
          { ok: false, error: "householdId, address, and seed are required." },
          { status: 400 }
        );
      }
      const hh = linkXrplWallet(householdId, address, seed);
      return NextResponse.json({
        ok: true,
        householdId: hh.id,
        xrplWallet: hh.xrplWallet,
        message: `Wallet ${address} linked to ${hh.name}. Next: create a trust line.`,
      });
    }

    /* ── Create RLUSD trust line ────────────────────── */
    if (action === "trustline") {
      const { householdId } = body;
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
      if (!hh.xrplWallet) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "No XRPL wallet linked to this household. Call with action=link first.",
          },
          { status: 400 }
        );
      }

      const txResult = await createRLUSDTrustLine(hh.xrplWallet.seed);
      markTrustLineCreated(householdId);

      const meta = txResult.result.meta;
      const txStatus =
        typeof meta === "object" && meta !== null && "TransactionResult" in meta
          ? (meta as { TransactionResult: string }).TransactionResult
          : "unknown";

      return NextResponse.json({
        ok: true,
        txHash: txResult.result.hash,
        txResult: txStatus,
        issuer: getIssuerAddress(),
        message:
          "Trust line created for RLUSD. This household can now receive RLUSD payouts.",
      });
    }

    /* ── Info: show program wallet ──────────────────── */
    if (action === "info") {
      try {
        const wallet = getProgramWallet();
        return NextResponse.json({
          ok: true,
          programWallet: wallet.address,
          issuer: getIssuerAddress(),
          rpcUrl: process.env.XRPL_RPC_URL ?? "wss://s.altnet.rippletest.net:51233",
        });
      } catch (err) {
        return NextResponse.json({
          ok: false,
          error:
            "XRPL_SEED not configured. Add XRPL_SEED and XRPL_ISSUER to your .env file.",
          details: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json(
      {
        ok: false,
        error:
          'Unknown action. Use "fund", "link", "trustline", or "info".',
      },
      { status: 400 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
