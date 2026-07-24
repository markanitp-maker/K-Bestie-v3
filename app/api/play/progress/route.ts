import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

/**
 * POST /api/play/progress — 놀이 진행률(백분율)을 서버 세션 상태에 기록한다.
 *
 * 목적: 자동환불(/api/play/callback/refund)이 클라이언트가 보낸 stage 만 신뢰하지 않고,
 * 서버에 저장된 실제 진행 흔적(progress_state)으로 "첫 문항 진입 전"을 재확인할 수 있게 한다.
 * MBTI 앱이 보내는 MBTI_PROGRESS(progressPercent) 를 메인 앱이 이 라우트로 전달해 저장한다.
 * 문항 답변 원문 등 민감정보는 저장하지 않고 진행률 백분율만 저장한다.
 */
export async function POST(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { child_id?: string; play_session_id?: string; progress_percent?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { child_id, play_session_id } = body;
  const progressPercent = Number(body.progress_percent);
  if (!child_id || !play_session_id || !Number.isFinite(progressPercent)) {
    return NextResponse.json({ error: "child_id, play_session_id, progress_percent required" }, { status: 400 });
  }

  const clamped = Math.max(0, Math.min(100, Math.round(progressPercent)));

  const service = createServiceClient();
  const authCheck = await requireChildAccess(service, user.id, child_id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // progress_state 는 이 놀이(MBTI 등)가 자체적으로 questionIndex/answers/progressVersion/
  // savedAt 같은 상세 진행 상태를 이미 저장해 두는 JSONB 컬럼이다 - { progressPercent }만
  // 통째로 덮어쓰면(과거 버그) 그 상세 진행 상태가 사라져서, 이후 그 놀이 앱 자신의 진행
  // 저장이 CAS 버전 비교에 실패해 매번 progress_version_conflict로 무시되는 2차 문제를
  // 일으켰다. progressPercent 필드만 병합(merge)해 얹고 나머지 필드는 보존한다.
  const { data: existingSession, error: readErr } = await service
    .from("k_play_sessions")
    .select("progress_state")
    .eq("id", play_session_id)
    .eq("child_id", child_id)
    .maybeSingle();

  if (readErr) {
    console.error("[play/progress] read error:", readErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if (!existingSession) {
    return NextResponse.json({ error: "Session not found or forbidden" }, { status: 403 });
  }

  const existingProgressState =
    typeof existingSession.progress_state === "object" && existingSession.progress_state !== null
      ? (existingSession.progress_state as Record<string, unknown>)
      : {};
  const mergedProgressState = { ...existingProgressState, progressPercent: clamped };

  // 세션 소유(id + child_id)를 WHERE 로 강제하므로 위조 세션은 0행 갱신되어 403 처리된다.
  const { data: updated, error: updErr } = await service
    .from("k_play_sessions")
    .update({ progress_state: mergedProgressState })
    .eq("id", play_session_id)
    .eq("child_id", child_id)
    .select("id");

  if (updErr) {
    console.error("[play/progress] update error:", updErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: "Session not found or forbidden" }, { status: 403 });
  }

  return NextResponse.json({ ok: true, progressPercent: clamped });
}
