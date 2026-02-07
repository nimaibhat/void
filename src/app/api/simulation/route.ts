/**
 * GET  /api/simulation         — Get full simulation state
 * POST /api/simulation         — Reset simulation
 */
import { NextResponse } from "next/server";
import { getSimState, resetSimulation } from "@/lib/simulation";

export async function GET() {
  return NextResponse.json({ ok: true, ...getSimState() });
}

export async function POST() {
  const state = resetSimulation();
  return NextResponse.json({ ok: true, ...state });
}
