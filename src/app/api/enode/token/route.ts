/**
 * GET /api/enode/token
 *
 * Returns a valid Enode access token (for debugging / testing).
 */
import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/enode";

export async function GET() {
  try {
    const token = await getAccessToken();
    return NextResponse.json({ ok: true, token });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
