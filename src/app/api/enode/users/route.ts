/**
 * GET  /api/enode/users          — List all Enode users
 * GET  /api/enode/users?id=<id>  — Get a specific user
 *
 * Note: In Enode, users are created implicitly when you generate
 * a Link session (POST /api/enode/link). There is no separate
 * "create user" endpoint.
 */
import { NextRequest, NextResponse } from "next/server";
import { listUsers, getUser } from "@/lib/enode";

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("id");

    if (userId) {
      const user = await getUser(userId);
      return NextResponse.json({ ok: true, user });
    }

    const users = await listUsers();
    return NextResponse.json({ ok: true, users: users.data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
