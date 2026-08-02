import { NextRequest, NextResponse, after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { validateAnswer } from "@/lib/mission/validateAnswer";
import { checkConsentForChild } from "@/lib/plan/consentGuard";
import { checkApprovalForChild } from "@/lib/plan/approvalGuard";
import { classifyAnswer } from "@/lib/questions/answer-classifier";
import { pickReaction } from "@/lib/freeChatReactions";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { assertMissionSessionActive } from "@/app/api/_lib/missionUtils";

export const runtime = "nodejs";

type QuestionState = "pending" | "answered" | "skipped" | "refused";

// childTurnId 기준 인메모리 캐시 (answer-lean 독립 스코프)
const answerLeanCache = new Map<string, { response: any; ts: number }>();
const ANSWER_LEAN_CACHE_TTL_MS = 15_000;

function getCachedAnswer(key: string): any | null {
  const hit = answerLeanCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > ANSWER_LEAN_CACHE_TTL_MS) {
    answerLeanCache.delete(key);
    return null;
  }
  return hit.response;
}

function setCachedAnswer(key: string, response: any) {
  if (answerLeanCache.size > 200) {
    const oldestKey = answerLeanCache.keys().next().value;
    if (oldestKey) answerLeanCache.delete(oldestKey);
  }
  answerLeanCache.set(key, { response, ts: Date.now() });
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) {
    console.error("[mission/answer-lean] Unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { sessionId?: string; questionId?: string; answerText?: string; childTurnId?: string };
  try {
    body = await req.json();
  } catch {
    console.error("[mission/answer-lean] Invalid JSON");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sessionId, questionId, answerText, childTurnId } = body;
  if (!sessionId || !questionId || typeof answerText !== "string") {
    console.error("[mission/answer-lean] sessionId, questionId, answerText required", { sessionId, questionId });
    return NextResponse.json({ error: "sessionId, questionId, answerText required" }, { status: 400 });
  }

  if (answerText.length > 500) {
    console.error("[mission/answer-lean] answerText too long", { sessionId, questionId });
    return NextResponse.json({ error: "answerText too long (max 500 characters)" }, { status: 400 });
  }

  if (childTurnId) {
    const cached = getCachedAnswer(childTurnId);
    if (cached !== null) {
      return NextResponse.json(cached);
    }
  }

  const service = createServiceClient();

  const { data: session, error: sessErr } = await service
    .from("chat_sessions")
    .select("id, session_type, child_id")
    .eq("id", sessionId)
    .single();

  if (sessErr || !session) {
    console.error("[mission/answer-lean] Session query failed:", { sessionId, err: sessErr });
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const authCheck = await requireChildAccess(service, user.id, session.child_id);
  if (!authCheck.allowed) {
    console.error("[mission/answer-lean] Forbidden", { sessionId, userId: user.id });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (session.session_type !== "mission") {
    console.error("[mission/answer-lean] Not a mission session", { sessionId });
    return NextResponse.json(
      { error: "answer validation is only allowed for mission sessions" },
      { status: 400 }
    );
  }

  const consentBlocked = await checkConsentForChild(session.child_id);
  if (consentBlocked) return consentBlocked;

  const approvalBlocked = await checkApprovalForChild(session.child_id);
  if (approvalBlocked) return approvalBlocked;

  const sessionCheck = await assertMissionSessionActive(service, sessionId);
  if (!sessionCheck.allowed) {
    console.error("[mission/answer-lean] Mission session not active or expired", { sessionId, status: sessionCheck.status });
    const resPayload = { error: sessionCheck.error, code: sessionCheck.code, status: sessionCheck.status, expired: sessionCheck.expired };
    if (childTurnId) setCachedAnswer(childTurnId, resPayload);
    return NextResponse.json(resPayload, { status: sessionCheck.expired ? 403 : 423 });
  }

  const { data: statusRow, error: statusErr } = await service
    .from("mission_progress")
    .select("status")
    .eq("session_id", sessionId)
    .single();

  if (statusErr || !statusRow) {
    console.error("[mission/answer-lean] status query failed:", { sessionId, err: statusErr });
    return NextResponse.json({ error: "Mission progress not found" }, { status: 404 });
  }

  if (statusRow.status === "SAFETY_PAUSED" || statusRow.status === "COMPLETED") {
    console.error("[mission/answer-lean] Mission is already completed or safety paused", { sessionId, status: statusRow.status });
    const resPayload = { error: "Mission is already completed or safety paused", status: statusRow.status };
    if (childTurnId) setCachedAnswer(childTurnId, resPayload);
    return NextResponse.json(resPayload, { status: 423 });
  }

  interface MissionProgressRow {
    session_id: string;
    valid_answer_count: number | null;
    question_ids: string[] | null;
    question_states: Record<string, QuestionState> | null;
    required_valid_count?: number | null;
    engine_version?: string | null;
  }

  const fields = "session_id, valid_answer_count, question_ids, question_states, required_valid_count, engine_version";
  const { data: progress, error: progErr } = (await service
    .from("mission_progress")
    .select(fields)
    .eq("session_id", sessionId)
    .single()) as unknown as { data: MissionProgressRow | null; error: { message: string } | null };

  if (progErr || !progress) {
    console.error("[mission/answer-lean] progress query failed:", { sessionId, err: progErr });
    return NextResponse.json({ error: "Mission progress not found" }, { status: 404 });
  }

  const requiredCount = progress.required_valid_count ?? 10;

  if (progress.engine_version !== "v2") {
    console.error("[mission/answer-lean] not a v2 engine session", { sessionId, engineVersion: progress.engine_version });
    return NextResponse.json({ error: "answer-lean is only supported for engine_version=v2 sessions" }, { status: 400 });
  }

  const questionIds: string[] = progress.question_ids ?? [];
  if (!questionIds.includes(questionId)) {
    console.error("[mission/answer-lean] questionId not part of this mission", { sessionId, questionId });
    return NextResponse.json({ error: "questionId not part of this mission" }, { status: 400 });
  }

  const states: Record<string, QuestionState> = { ...(progress.question_states ?? {}) };
  const prevState = states[questionId] ?? "pending";

  if (prevState === "answered") {
    const resPayload = {
      valid: true,
      reason: "already_answered",
      refused: false,
      previousState: prevState,
      questionState: "answered",
      validAnswerCount: progress.valid_answer_count ?? 0,
      progressPercent: (progress.valid_answer_count ?? 0) * 10,
      requiredCount: requiredCount,
      completed: (progress.valid_answer_count ?? 0) >= requiredCount,
      newlyCompleted: false,
      progressStatus: statusRow.status,
      engine_version: "v2",
      questionStates: states,
      rewardStatus: "none",
    };
    console.log("[mission/answer-lean] done", { sessionId, classification: "ALREADY_ANSWERED", valid: true, durationMs: Date.now() - startedAt });
    if (childTurnId) setCachedAnswer(childTurnId, resPayload);
    return NextResponse.json(resPayload);
  }

  // asked_order 카운트 조회
  const { count: askedCount, error: askedCountErr } = await service
    .from("mission_question_history")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .not("asked_order", "is", null);

  if (askedCountErr) {
    console.error("[mission/answer-lean] Failed to count asked_order:", { sessionId, questionId, err: askedCountErr });
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // asked_order 및 asked_at 업데이트
  const { error: updOrderErr } = await service
    .from("mission_question_history")
    .update({
      asked_order: (askedCount ?? 0) + 1,
      asked_at: new Date().toISOString(),
    })
    .eq("session_id", sessionId)
    .eq("question_id", questionId)
    .is("asked_order", null);

  if (updOrderErr) {
    console.error("[mission/answer-lean] Failed to update asked_order and asked_at:", { sessionId, questionId, err: updOrderErr });
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // 질문 텍스트 조회 (백그라운드 classifyAnswer 용)
  const { data: qData, error: qDataErr } = await service
    .from("mission_questions")
    .select("question_text")
    .eq("id", questionId)
    .single();

  if (qDataErr) {
    console.error("[mission/answer-lean] Failed to fetch question text:", { sessionId, questionId, err: qDataErr });
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  const questionText = qData?.question_text ?? "";

  // 1. 빠른 동기 안전 신호 검사 (pickReaction 사용)
  const rx = pickReaction(answerText);
  if (rx.category === "safety") {
    const { data: rpcData, error: rpcErr } = await service.rpc("record_v2_safety_pause", {
      p_session_id: sessionId,
      p_child_id: session.child_id,
      p_question_id: questionId,
      p_answer_text: answerText,
      p_safety_subcategory: rx.safetySubcategory || "violence",
    });

    if (rpcErr || !rpcData || rpcData.length === 0) {
      console.error("[mission/answer-lean] record_v2_safety_pause RPC error:", { sessionId, questionId, err: rpcErr });
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    const rpcResult = rpcData[0] as { blocked: boolean; history_id: string };
    if (rpcResult.blocked) {
      console.error("[mission/answer-lean] Blocked by safety pause", { sessionId, questionId });
      const resPayload = { error: "Mission is already completed or safety paused", status: "SAFETY_PAUSED" };
      if (childTurnId) setCachedAnswer(childTurnId, resPayload);
      return NextResponse.json(resPayload, { status: 423 });
    }

    const resPayload = {
      valid: false,
      reason: "safety_signal",
      refused: false,
      previousState: prevState,
      questionState: "skipped" as const,
      validAnswerCount: progress.valid_answer_count ?? 0,
      progressPercent: (progress.valid_answer_count ?? 0) * 10,
      requiredCount: requiredCount,
      completed: false,
      engine_version: "v2",
      questionStates: states,
    };

    console.log("[mission/answer-lean] done (safety_signal)", { sessionId, valid: false, durationMs: Date.now() - startedAt });
    if (childTurnId) setCachedAnswer(childTurnId, resPayload);
    // 안전 일시정지 조기 종료 시에는 아래 백그라운드 분석을 진행하지 않고 즉시 return
    return NextResponse.json(resPayload);
  }

  // 2. 안전 신호가 아니면 validateAnswer(answerText)로 빠른 동기 유효성 판정
  const valRes = validateAnswer(answerText);
  let classification: "VALID" | "REFUSAL" | "NO_RESPONSE";
  let newState: QuestionState;
  let answerStatus: "answered" | "skipped" | "refused";

  if (valRes.valid) {
    classification = "VALID";
    newState = "answered";
    answerStatus = "answered";
  } else if (valRes.refused) {
    classification = "REFUSAL";
    newState = "refused";
    answerStatus = "refused";
  } else {
    classification = "NO_RESPONSE";
    newState = "skipped";
    answerStatus = "skipped";
  }

  // record_v2_mission_answer RPC 호출
  const { data: rpcData, error: rpcErr } = await service.rpc("record_v2_mission_answer", {
    p_session_id: sessionId,
    p_child_id: session.child_id,
    p_question_id: questionId,
    p_answer_status: answerStatus,
    p_answer_classification: classification,
    p_required_valid_count: requiredCount,
    p_reward_type: "mission_complete",
  });

  if (rpcErr || !rpcData || rpcData.length === 0) {
    console.error("[mission/answer-lean] record_v2_mission_answer RPC error:", { sessionId, questionId, err: rpcErr });
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const rpcResult = rpcData[0] as {
    blocked: boolean;
    valid_answer_count: number;
    completed: boolean;
    newly_completed: boolean;
    reward_status: string;
    status: string;
    question_states: Record<string, string>;
  };

  if (rpcResult.blocked) {
    console.error("[mission/answer-lean] Blocked after answer RPC", { sessionId, questionId, status: rpcResult.status });
    const resPayload = { error: "Mission is already completed or safety paused", status: rpcResult.status };
    if (childTurnId) setCachedAnswer(childTurnId, resPayload);
    return NextResponse.json(resPayload, { status: 423 });
  }

  const finalQuestionStates = { ...rpcResult.question_states };

  const resPayload = {
    valid: classification === "VALID",
    reason: classification !== "VALID" ? classification : null,
    refused: classification === "REFUSAL",
    previousState: prevState,
    questionState: newState,
    validAnswerCount: rpcResult.valid_answer_count,
    progressPercent: rpcResult.valid_answer_count * 10,
    requiredCount: requiredCount,
    completed: rpcResult.completed,
    newlyCompleted: rpcResult.newly_completed,
    progressStatus: rpcResult.status,
    engine_version: "v2",
    questionStates: finalQuestionStates,
    rewardStatus: rpcResult.reward_status,
  };

  // 응답 생성 직전 타임스탬프 기록 (server_state_confirmed, fire-and-forget)
  if (childTurnId) {
    service.from("turn_timing_events").insert({
      session_id: sessionId,
      turn_id: childTurnId,
      event_name: "server_state_confirmed",
    }).then(() => {}, () => {});
  }

  console.log("[mission/answer-lean] done", { sessionId, classification, valid: resPayload.valid, validAnswerCount: resPayload.validAnswerCount, durationMs: Date.now() - startedAt });
  if (childTurnId) setCachedAnswer(childTurnId, resPayload);

  // Next.js after()를 통한 백그라운드 2차 감지 & 타이밍 이벤트 기록
  after(async () => {
    try {
      // 2차 감사/안전망 백그라운드 LLM 판정
      const bgClassResult = await classifyAnswer(questionText, answerText);
      const bgClass = bgClassResult.classification;
      if (bgClass === "SAFETY_SIGNAL") {
        // 빠른 키워드 검사가 놓친 경우 차선 안전망으로 사후 안전 일시정지 기록
        const safetyRx = pickReaction(answerText);
        await service.rpc("record_v2_safety_pause", {
          p_session_id: sessionId,
          p_child_id: session.child_id,
          p_question_id: questionId,
          p_answer_text: answerText,
          p_safety_subcategory: safetyRx.safetySubcategory || "violence",
        });
        console.warn("[mission/answer-lean] Background safety pause triggered by LLM classification", { sessionId, questionId });
      } else {
        console.log("[mission/answer-lean] background classification", { sessionId, questionId, bgClass });
      }
    } catch (bgErr) {
      console.error("[mission/answer-lean] Background classification failed (non-fatal):", bgErr);
    }

    if (childTurnId) {
      try {
        await service.from("turn_timing_events").insert({
          session_id: sessionId,
          turn_id: childTurnId,
          event_name: "background_analysis_completed",
        });
      } catch (evtErr) {
        console.error("[mission/answer-lean] Failed to insert background_analysis_completed event:", evtErr);
      }
    }
  });

  return NextResponse.json(resPayload);
}
