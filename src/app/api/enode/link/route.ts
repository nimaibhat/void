/**
 * POST /api/enode/link
 *
 * Generate an Enode Link UI session. The returned URL opens a modal
 * where the user "logs into" a virtual vendor to connect sandbox devices.
 *
 * This also implicitly creates the Enode user if they don't exist yet.
 *
 * Body: { userId: string, vendor?: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { createLinkSession } from "@/lib/enode";

export async function POST(req: NextRequest) {
  try {
    const { userId, vendor } = await req.json();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "userId is required" },
        { status: 400 }
      );
    }

    // After linking, Enode redirects here
    const redirectUri =
      process.env.ENODE_REDIRECT_URI ??
      `${req.nextUrl.origin}/devices?linked=true`;

    const session = await createLinkSession(userId, redirectUri, {
      vendor: vendor || undefined,
    });

    return NextResponse.json({ ok: true, ...session });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
