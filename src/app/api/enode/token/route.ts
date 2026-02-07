/**
 * GET /api/enode/token
 *
 * Returns the current OAuth access token (for debugging).
 * In production you'd never expose this — it's here for dev/testing only.
 */
import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/enode";

export async function GET() {
  try {
    const token = await getAccessToken();
    return NextResponse.json({ ok: true, token: token.slice(0, 20) + "…" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
