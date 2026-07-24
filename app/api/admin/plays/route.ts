import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const adminRes = await requireAdmin();
    if (adminRes) return adminRes;

    const { searchParams } = new URL(req.url);
    const kind = searchParams.get("kind") || "sessions";
    const play_type = searchParams.get("play_type");
    const status = searchParams.get("status");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const child_id = searchParams.get("child_id");
    const session_id = searchParams.get("session_id");

    const serviceClient = createServiceClient();
    
    let table = "";
    if (kind === "sessions") table = "k_play_sessions";
    else if (kind === "bugs") table = "play_bug_reports";
    else if (kind === "support") table = "support_requests";
    else return NextResponse.json({ error: "Invalid kind" }, { status: 400 });

    let query = serviceClient.from(table).select("*");

    if (play_type) query = query.eq("play_type", play_type);
    if (status) query = query.eq("status", status);
    if (from) query = query.gte("created_at", from);
    if (to) query = query.lte("created_at", to);
    if (child_id && (kind === "sessions" || kind === "bugs" || kind === "support")) {
      query = query.eq("child_id", child_id);
    }
    if (session_id) {
      if (kind === "sessions") query = query.eq("id", session_id);
      else if (kind === "bugs" || kind === "support") query = query.eq("play_session_id", session_id);
    }

    query = query.order("created_at", { ascending: false }).limit(100);

    const { data, error } = await query;

    if (error) {
      console.error("[admin/plays] Select error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error("[admin/plays] route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
