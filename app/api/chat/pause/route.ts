import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { sessionId?: string; turnCount?: number; ended?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { sessionId, turnCount, ended } = body;
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const updateData: any = {
    turn_count: typeof turnCount === "number" ? turnCount : 0
  };
  if (ended) {
    updateData.ended_at = new Date().toISOString();
  }

  const { data: updatedSession, error } = await supabase
    .from("chat_sessions")
    .update(updateData)
    .eq("id", sessionId)
    .select("child_id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (ended && updatedSession) {
    const service = createServiceClient();
    const { data: childData } = await service.from("child_profiles").select("family_id").eq("id", updatedSession.child_id).single();
    await logBehaviorEvent({
      eventName: "freechat_complete",
      actorType: "child",
      childId: updatedSession.child_id,
      familyId: childData?.family_id,
      sessionId,
      durationSeconds: undefined,
      feature: "freechat",
      route: "/api/chat/pause",
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
