/**
 * GET /api/enode/devices?userId=<userId>
 *
 * List all connected devices (chargers, HVAC, batteries, vehicles,
 * solar inverters) for a given Enode user.
 */
import { NextRequest, NextResponse } from "next/server";
import { listAllDevices } from "@/lib/enode";

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "userId query param is required" },
        { status: 400 }
      );
    }

    const devices = await listAllDevices(userId);
    return NextResponse.json({ ok: true, devices });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
