import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getVoiceModeForChild } from "@/lib/plan/voiceMode";
import { estimateCost } from "@/lib/plan/pricing";
import { normalizeConversationMode } from "@/lib/plan/conversationMode";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

// POST /api/usage/live { event: "start" | "end", sessionId, tokenIn?, tokenOut? }
// child_id/tier/voice_mode는 클라이언트가 직접 제공하지 않고 sessionId로 서버가 해석한다(server-trust).
// start: usage_events(kind='live_audio') row (ended_at=NULL로 insert)
// end: 해당 아이의 진행중(ended_at IS NULL) 최신 live_audio row를 duration_sec/ended_at으로 UPDATE.
//   tokenIn/tokenOut(Gemini usageMetadata 누적치)이 오면 token_in/token_out을 저장하고 공식 단가로 정밀 계산,
//   없으면 durationSec 기반 추정치로 폴백한다.
//   비정상 종료(탭 강제 종료 등)로 end가 안 오면 start row는 ended_at=NULL로 그대로 남는다(의도된 동작).
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { event?: "start" | "end"; sessionId?: string; tokenIn?: number; tokenOut?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { event, sessionId, tokenIn, tokenOut } = body;
  if (!sessionId || (event !== "start" && event !== "end")) {
    return NextResponse.json({ error: "event(start|end), sessionId required" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: session } = await service
    .from("chat_sessions")
    .select("child_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session?.child_id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const authCheck = await requireChildAccess(supabase, user.id, session.child_id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const childId = session.child_id;

  if (event === "start") {
    const { tier, voiceMode } = await getVoiceModeForChild(childId);
    const { data: inserted, error } = await service
      .from("usage_events")
      .insert({ child_id: childId, tier, voice_mode: voiceMode, kind: "live_audio", conversation_mode: normalizeConversationMode((body as { conversationMode?: unknown }).conversationMode) })
      .select("id")
      .single();

    if (error || !inserted) {
      return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id: inserted.id });
  }

  // event === "end"
  const { data: openRow } = await service
    .from("usage_events")
    .select("id, created_at")
    .eq("child_id", childId)
    .eq("kind", "live_audio")
    .is("ended_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!openRow) {
    // start row가 없거나 이미 종료됨 — 멱등 처리
    return NextResponse.json({ ok: true, updated: false });
  }

  const durationSec = (Date.now() - new Date(openRow.created_at).getTime()) / 1000;
  const hasTokenCounts = typeof tokenIn === "number" && typeof tokenOut === "number";
  const estCostKrw = estimateCost({
    kind: "live_audio",
    durationSec,
    tokenIn: hasTokenCounts ? tokenIn : undefined,
    tokenOut: hasTokenCounts ? tokenOut : undefined,
  });

  const { error: updateError } = await service
    .from("usage_events")
    .update({
      duration_sec: durationSec,
      ended_at: new Date().toISOString(),
      est_cost_krw: estCostKrw,
      ...(hasTokenCounts ? { token_in: tokenIn, token_out: tokenOut } : {}),
    })
    .eq("id", openRow.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: true });
}
