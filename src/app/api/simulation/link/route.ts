/**
 * POST /api/simulation/link
 *
 * Link a real Enode device to one of the simulated households.
 *
 * Body: { householdId: string, enodeUserId: string, enodeHvacId: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { linkRealDevice } from "@/lib/simulation";

export async function POST(req: NextRequest) {
  try {
    const { householdId, enodeUserId, enodeHvacId } = await req.json();

    if (!householdId || !enodeUserId || !enodeHvacId) {
      return NextResponse.json(
        {
          ok: false,
          error: "householdId, enodeUserId, and enodeHvacId are required",
        },
        { status: 400 }
      );
    }

    const household = linkRealDevice(householdId, enodeUserId, enodeHvacId);
    return NextResponse.json({ ok: true, household });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
