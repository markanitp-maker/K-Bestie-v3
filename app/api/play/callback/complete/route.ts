import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { child_id, play_session_id, result_type } = body;
    if (!child_id || !play_session_id) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { allowed } = await requireChildAccess(supabase, user.id, child_id);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const serviceClient = createServiceClient();

    const { data: session, error: sessionErr } = await serviceClient
      .from("k_play_sessions")
      .select("child_id, status")
      .eq("id", play_session_id)
      .maybeSingle();

    if (sessionErr || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (session.child_id !== child_id) {
      return NextResponse.json({ error: "Session ownership mismatch" }, { status: 403 });
    }

    // 이미 완료/환불된 세션이면 그대로 idempotent하게 성공 응답만 반환(중복 완료 호출 방지).
    if (session.status !== "in_progress") {
      return NextResponse.json({ ok: true, already: true, status: session.status });
    }

    const { error: updateErr } = await serviceClient
      .from("k_play_sessions")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        progress_state: result_type ? { result_type } : undefined,
      })
      .eq("id", play_session_id)
      .eq("status", "in_progress");

    if (updateErr) {
      console.error("[callback/complete] Failed to update session status:", updateErr);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[callback/complete] route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
