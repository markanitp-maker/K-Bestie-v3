import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { assertMissionSessionActive } from "@/app/api/_lib/missionUtils";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const body = await req.json();
    const { sessionId, turnId, eventName } = body;
    if (!sessionId || !turnId || !eventName) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const authService = createServiceClient();
    const { data: session } = await authService
      .from("chat_sessions")
      .select("child_id")
      .eq("id", sessionId)
      .single();
      
    if (!session) {
      return NextResponse.json({ ok: false }, { status: 404 });
    }

    const authCheck = await requireChildAccess(authService, user.id, session.child_id);
    if (!authCheck.allowed) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }

    const sessionCheck = await assertMissionSessionActive(authService, sessionId);
    if (!sessionCheck.allowed) {
      return NextResponse.json({ ok: false, error: sessionCheck.error, code: sessionCheck.code }, { status: 403 });
    }

    const { error } = await authService.from("turn_timing_events").insert({
      session_id: sessionId,
      turn_id: turnId,
      event_name: eventName,
    });

    if (error) {
      console.error("[mission/timing] insert error:", error.message);
      return NextResponse.json({ ok: false });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[mission/timing] error", err);
    return NextResponse.json({ ok: false });
  }
}
