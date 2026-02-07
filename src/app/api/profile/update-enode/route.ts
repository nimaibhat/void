/**
 * POST /api/profile/update-enode
 *
 * Update enode_user_id for a profile
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: NextRequest) {
  try {
    const { profileId, enodeUserId } = await req.json();

    if (!profileId || !enodeUserId) {
      return NextResponse.json(
        { ok: false, error: "profileId and enodeUserId are required" },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { error } = await supabase
      .from("consumer_profiles")
      .update({ enode_user_id: enodeUserId })
      .eq("id", profileId);

    if (error) {
      console.error("Failed to update enode_user_id:", error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Exception updating enode:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
