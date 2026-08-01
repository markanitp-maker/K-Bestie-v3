import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { sessionId } = body;
    if (!sessionId) {
      return NextResponse.json({ ok: false, error: "Missing sessionId" }, { status: 400 });
    }

    const authService = createServiceClient();
    const { data: session } = await authService
      .from("chat_sessions")
      .select("child_id, turn_count")
      .eq("id", sessionId)
      .maybeSingle();

    if (!session) {
      return NextResponse.json({ ok: false, error: "Session not found" }, { status: 404 });
    }

    const authCheck = await requireChildAccess(authService, user.id, session.child_id);
    if (!authCheck.allowed) {
      return NextResponse.json({ ok: false, error: "Access denied" }, { status: 403 });
    }

    const { data: rpcData, error: rpcErr } = await authService.rpc("force_end_mission_session_if_expired", {
      p_session_id: sessionId,
    });

    if (rpcErr) {
      console.error("[mission/force-end] RPC error:", rpcErr.message);
      return NextResponse.json({ ok: false, error: rpcErr.message }, { status: 500 });
    }

    const rpcStatus = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (rpcStatus === "NOT_EXPIRED") {
      return NextResponse.json({ ok: false, status: "NOT_EXPIRED", error: "Session has not expired yet" }, { status: 409 });
    }
    if (rpcStatus === "FORCE_ENDED" || rpcStatus === "ALREADY_ENDED") {
      return NextResponse.json({ ok: true, status: rpcStatus });
    }

    return NextResponse.json({ ok: false, error: `Unexpected RPC status: ${rpcStatus}` }, { status: 500 });
  } catch (err: any) {
    console.error("[mission/force-end] Error:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
