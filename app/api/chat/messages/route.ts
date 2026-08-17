import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { checkConsentForChild } from "@/lib/plan/consentGuard";
import { checkApprovalForChild } from "@/lib/plan/approvalGuard";
import { assertMissionSessionActive } from "@/app/api/_lib/missionUtils";
import { scheduleVacationEventDetection, processVacationEventDetection } from "@/lib/plan/vacationEventDetector";


export const runtime = "nodejs";

// GET /api/chat/messages?sessionId=xxx
// 스크롤백(과거 대화 다시 불러오기)용 — 반드시 그 세션의 아이 본인만 조회 가능.
// 프라이버시 원칙(부모 원문 열람 불가)을 RLS 우회 후에도 동일하게 지키기 위해
// family_members.user_id === 현재 로그인 사용자 로 직접 검증한다(부모 계정은 절대 통과 못 함).
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const service = createServiceClient();

  const { data: session } = await service
    .from("chat_sessions")
    .select("id, child_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data: child } = await service
    .from("child_profiles")
    .select("member_id")
    .eq("id", session.child_id)
    .maybeSingle();
  if (!child?.member_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: member } = await service
    .from("family_members")
    .select("user_id")
    .eq("id", child.member_id)
    .maybeSingle();

  // 세션 소유 아이 본인만 통과 — 부모/다른 가족 구성원은 user_id가 달라 여기서 막힘
  if (!member?.user_id || member.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const consentBlocked = await checkConsentForChild(session.child_id);
  if (consentBlocked) return consentBlocked;

  const approvalBlocked = await checkApprovalForChild(session.child_id);
  if (approvalBlocked) return approvalBlocked;

  const { data: messages, error } = await service
    .from("chat_messages")
    .select("role, content, created_at, display_sequence, turn_status")
    .eq("session_id", sessionId)
    .eq("turn_status", "finalized")
    .order("display_sequence", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const finalizedCount = messages?.filter(m => m.turn_status === "finalized").length ?? 0;
  console.log("[chat/messages GET] result", { sessionId, messageCount: messages?.length ?? 0, finalizedCount });

  return NextResponse.json({ messages: messages ?? [] });
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.error("[chat/messages] POST Unauthorized", { user: null });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { sessionId?: string; role?: string; content?: string; voiceMode?: string; asrConfidence?: number; displaySequence?: number; turnId?: string; isClarification?: boolean };
  try {
    body = await req.json();
  } catch (err) {
    console.error("[chat/messages] POST Invalid JSON", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sessionId, role, content, voiceMode: bodyVoiceMode, asrConfidence, displaySequence, turnId, isClarification } = body;
  console.log("[chat/messages] POST start", { sessionId, turnId, role });

  if (!sessionId || !role || !content?.trim()) {
    console.error("[chat/messages] missing required fields", { sessionId, turnId, role });
    return NextResponse.json({ error: "sessionId, role, content required" }, { status: 400 });
  }
  if (role !== "child" && role !== "k") {
    console.error("[chat/messages] invalid role", { sessionId, turnId, role });
    return NextResponse.json({ error: "role must be child or k" }, { status: 400 });
  }

  const service = createServiceClient();

  const { data: session, error: sessionError } = await service
    .from("chat_sessions")
    .select("id, session_type, child_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError || !session) {
    console.error("[chat/messages] session not found", { sessionId, turnId });
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data: child } = await service
    .from("child_profiles")
    .select("member_id")
    .eq("id", session.child_id)
    .maybeSingle();
  if (!child?.member_id) {
    console.error("[chat/messages] forbidden (child)", { sessionId, turnId });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: member } = await service
    .from("family_members")
    .select("user_id")
    .eq("id", child.member_id)
    .maybeSingle();

  // 세션 소유 아이 본인만 통과 — 부모/다른 가족 구성원은 user_id가 달라 여기서 막힘
  if (!member?.user_id || member.user_id !== user.id) {
    console.error("[chat/messages] forbidden (member)", { sessionId, turnId });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const consentBlocked = await checkConsentForChild(session.child_id);
  if (consentBlocked) {
    console.error("[chat/messages] consent blocked", { sessionId, turnId });
    return consentBlocked;
  }

  // mode: 기존 session_type 재사용(추가 쿼리 없음). 자유대화는 라이브가 없으므로
  // voice_mode를 클라이언트 입력과 무관하게 항상 stt_tts로 서버가 클램프한다.
  const mode: "mission" | "free_chat" = session.session_type === "mission" ? "mission" : "free_chat";
  const voiceMode: "stt_tts" | "live" =
    mode === "free_chat" ? "stt_tts" : bodyVoiceMode === "live" ? "live" : "stt_tts";

  if (mode === "mission") {
    const sessionCheck = await assertMissionSessionActive(service, sessionId);
    if (!sessionCheck.allowed) {
      console.error("[chat/messages] mission session active check failed", { sessionId, turnId, status: sessionCheck.status });
      return NextResponse.json(
        { error: sessionCheck.error, code: sessionCheck.code, status: sessionCheck.status, expired: sessionCheck.expired },
        { status: sessionCheck.expired ? 403 : 423 }
      );
    }

    if (typeof displaySequence !== "number" || !Number.isInteger(displaySequence)) {
      console.error("[chat/messages] invalid displaySequence", { sessionId, turnId, displaySequence });
      return NextResponse.json({ error: "displaySequence must be a valid integer for mission messages" }, { status: 400 });
    }
    if (typeof turnId !== "string" || !turnId.trim()) {
      console.error("[chat/messages] invalid turnId", { sessionId, turnId });
      return NextResponse.json({ error: "turnId must be a valid string for mission messages" }, { status: 400 });
    }
  }

  const { data: upserted, error } = await service
    .from("chat_messages")
    .upsert({ 
      session_id: sessionId, 
      turn_id: turnId ?? null,
      role, 
      content: content.trim(), 
      mode, 
      voice_mode: voiceMode, 
      display_sequence: mode === "mission" ? displaySequence : (displaySequence ?? null),
      is_clarification: isClarification ?? false
    }, { onConflict: "session_id,turn_id", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.error("[chat/messages] upsert failed", { sessionId, turnId, role, mode, message: error.message, code: error.code });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (role === "child") {
    try {
      await processVacationEventDetection(service, session.child_id, content.trim(), sessionId, turnId);
    } catch (err) {
      console.error("[chat/messages] vacation event detection failed (non-fatal):", err);
    }
  }


  // 2026-08-17: ignoreDuplicates 로 조용히 버려지면 클라이언트는 200 을 받고
  // 저장된 줄 안다. 실제로 K 응답이 통째로 유실되는데 로그가 없어 며칠간 못 봤다.
  // 버려진 경우를 반드시 남긴다.
  const skipped = Array.isArray(upserted) && upserted.length === 0;
  if (skipped) {
    console.warn("[chat/messages] upsert SKIPPED by duplicate turn_id — 저장되지 않았다", {
      sessionId, turnId, role, mode,
    });
  }

  console.log("[chat/messages] POST done", { sessionId, turnId, durationMs: Date.now() - startedAt, status: skipped ? "skipped_duplicate" : "success" });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { sessionId?: string; turnId?: string; turnStatus?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sessionId, turnId, turnStatus } = body;
  if (!sessionId || !turnId || turnStatus !== "cancelled") {
    return NextResponse.json({ error: "sessionId, turnId, turnStatus='cancelled' required" }, { status: 400 });
  }

  const service = createServiceClient();

  const { data: session, error: sessionError } = await service
    .from("chat_sessions")
    .select("id, child_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data: child } = await service
    .from("child_profiles")
    .select("member_id")
    .eq("id", session.child_id)
    .maybeSingle();
  if (!child?.member_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: member } = await service
    .from("family_members")
    .select("user_id")
    .eq("id", child.member_id)
    .maybeSingle();

  if (!member?.user_id || member.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 업데이트 수행 (에러가 나도 실패 응답하지 않음)
  await service
    .from("chat_messages")
    .update({ turn_status: "cancelled" })
    .eq("session_id", sessionId)
    .eq("turn_id", turnId)
    .eq("turn_status", "finalized");

  return NextResponse.json({ ok: true });
}

