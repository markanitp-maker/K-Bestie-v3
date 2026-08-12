import { NextRequest, NextResponse, after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { validateAnswer } from "@/lib/mission/validateAnswer";
import { earnMissionCompleteKey } from "@/lib/goldkey/ledger";
import { checkConsentForChild } from "@/lib/plan/consentGuard";
import { checkApprovalForChild } from "@/lib/plan/approvalGuard";
import { isQuestionEngineV2Enabled } from "@/lib/questions/feature-flags";
import { classifyAnswer } from "@/lib/questions/answer-classifier";
import { pickReaction } from "@/lib/freeChatReactions";
import { getKstBusinessDate } from "@/lib/utils/kstBusinessDate";
import { detectVacationEvent } from "@/lib/plan/vacationEventDetector";
import { applyVacationEvent, getActiveVacationContext, resolveSchoolQuestionBlockState } from "@/lib/plan/vacationSchoolContext";

// 068: 방학/개학 관련 키워드가 있을 때만 LLM 이벤트 감지를 호출한다(매 턴 LLM 호출 비용
// 방지). 지시서 6장 예시 키워드 그대로.
// claude-review 지적(개학일 후속답변이 "8월 20일"처럼 순수 날짜/요일 표현만으로 올 수
// 있음) 반영 — 날짜/요일 패턴도 함께 감지 대상에 포함한다.
const VACATION_KEYWORD_PATTERN = /방학|개학|학교\s*안\s*가|여름방학|겨울방학|모르겠|기억\s*안|날짜\s*몰라|엄마가\s*알아|미뤄졌|날짜\s*바뀌|다녀왔|다녀\s*왔|갔다\s*왔|\d+\s*월\s*\d+\s*일|다음\s*주|이번\s*주|다음\s*달|이번\s*달|(월|화|수|목|금|토|일)요일/;

// 068: 아이 발화에서 방학/개학 이벤트를 감지해 child_temporal_context를 갱신한다.
// 반드시 미션 답변 처리(진행률/보상/다음질문) 응답 시간에 전혀 영향을 주면 안 되므로
// Next.js `after()`(이 라우트 파일 그룹의 다른 파일들 — respond/route.ts,
// stt/route.ts 등 — 이 이미 쓰는 확립된 패턴)로 응답 전송 후 백그라운드에서 실행한다.
// (실측 Dev 검증: 응답 흐름 안에서 await+짧은 타임아웃으로 감싸는 방식은 LLM 호출이
// 타임아웃 예산을 자주 넘겨 감지 자체가 무력화됐다 — after()로 전환해 해결.)
// - 키워드 사전필터로 관련 없는 턴에서는 아예 호출하지 않는다.
// - 어떤 에러가 나도 절대 throw하지 않는다(백그라운드 실행이라 응답에는 영향 없지만,
//   미처리 예외로 함수 인스턴스가 불안정해지는 것을 방지하기 위해 항상 catch한다).
function scheduleVacationEventDetection(
  service: ReturnType<typeof createServiceClient>,
  childId: string,
  answerText: string,
  sessionId: string,
  childTurnId?: string
): void {
  if (!VACATION_KEYWORD_PATTERN.test(answerText)) return;
  after(async () => {
    try {
      const businessDate = getKstBusinessDate();
      const event = await detectVacationEvent(answerText, businessDate);
      console.log("[mission/answer] vacation event detected:", { childId, eventType: event?.eventType, schoolStartDate: event?.schoolStartDate });
      if (!event || event.eventType === "NONE") return;
      await applyVacationEvent(
        service,
        childId,
        { eventType: event.eventType, schoolStartDate: event.schoolStartDate },
        businessDate,
        sessionId,
        childTurnId
      );
      console.log("[mission/answer] vacation context applied:", { childId, eventType: event.eventType });
    } catch (err) {
      console.error("[mission/answer] vacation event detection failed (non-fatal):", err);
    }
  });
}

async function pickNonSchoolQuestionId(service: any, candidateIds: string[], blocked: boolean): Promise<string> {
  if (!blocked || candidateIds.length === 0) return candidateIds[0];
  const { data } = await service.from("mission_questions").select("id, school_context_tag").in("id", candidateIds);
  const tagMap = new Map((data ?? []).map((r: any) => [r.id, r.school_context_tag]));
  const nonSchool = candidateIds.find(id => tagMap.get(id) !== "school_required");
  return nonSchool ?? candidateIds[0];
}

// 컬럼 정의 통일:
// - answer_status: 레거시 상태값(answered/skipped/refused). UI 하위호환을 위해 계속 기록되지만 더 이상 진행률 판정의 권위값이 아니다.
// - answer_classification: 질문 엔진 V2의 최종 판정 source of truth(VALID/PARTIAL/REFUSAL/NO_RESPONSE/SAFETY_SIGNAL). progress_awarded와 함께 서버 진행률 계산의 기준이 된다.
// - progress_awarded: 이 답변이 실제로 진행률에 반영됐는지 여부(boolean).

import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";
import { selectAdditionalReserveQuestions, parseGrade, getEffectiveContentGrade } from "@/lib/mission/selectQuestions";
import { computeParentQuestionLifecycleUpdate, paraphraseAnswerForParent } from "@/lib/mission/parentQuestionReconfirm";
import { getModelForGroup, createGenAIClient } from "@/app/api/_lib/ai";
import { getLlmModel } from "@/lib/llm/modelRouter";
import { assertMissionSessionActive } from "@/app/api/_lib/missionUtils";
import { recordMissionOnboardingCompletion } from "@/lib/events/missionOnboarding";

export const runtime = "nodejs";

const REQUIRED_COUNT = 5; // V1 게이지 완료 기준 (유효답변 5칸)

type QuestionState = "pending" | "answered" | "skipped" | "refused";

// childTurnId 기준 인메모리 캐시 추가
const answerCache = new Map<string, { response: any; ts: number }>();
const ANSWER_CACHE_TTL_MS = 15_000;

function getCachedAnswer(key: string): any | null {
  const hit = answerCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > ANSWER_CACHE_TTL_MS) {
    answerCache.delete(key);
    return null;
  }
  return hit.response;
}

function setCachedAnswer(key: string, response: any) {
  if (answerCache.size > 200) {
    const oldestKey = answerCache.keys().next().value;
    if (oldestKey) answerCache.delete(oldestKey);
  }
  answerCache.set(key, { response, ts: Date.now() });
}

type ActiveParentQuestion = {
  id: string;
  question_text: string;
  mission_confirm_attempts: number | null;
  confirmation_question_text: string | null;
  child_answer_summary: string | null;
};

// §10 "대화 원문 직접 노출 금지" — parentUpdate가 방금 "confirmed"로 확정하는 경우에만
// child_answer_summary를 부모 노출용 3인칭 요약으로 덮어쓴다(원문은 재확인 라운드
// 중에만 내부적으로 잠깐 보관되고, 확정 순간에 순화된다).
async function finalizeParentAnswerSummaryIfConfirmed(
  parentUpdate: Record<string, unknown>,
  activeParentQ: ActiveParentQuestion,
  rawConfirmedAnswer: string,
): Promise<Record<string, unknown>> {
  if (parentUpdate.status !== "confirmed") return parentUpdate;
  try {
    const model = await getModelForGroup("B");
    const ai = createGenAIClient(model);
    const summary = await paraphraseAnswerForParent(
      ai,
      getLlmModel("parentQuestionGeneration"),
      activeParentQ.question_text,
      rawConfirmedAnswer,
    );
    return { ...parentUpdate, child_answer_summary: summary };
  } catch (e) {
    console.error("[mission/answer] 부모 노출용 답변 요약 생성 중 예외 — 안전 문구로 대체", e);
    return { ...parentUpdate, child_answer_summary: "아이가 질문에 답변했어요." };
  }
}

async function findParentQuestionDeliveredInSession(
  service: ReturnType<typeof createServiceClient>,
  childId: string,
  sessionId: string,
): Promise<ActiveParentQuestion | null> {
  const { data: activeQuestion, error: questionError } = await service
    .from("parent_questions")
    .select("id, question_text, mission_confirm_attempts, confirmation_question_text, child_answer_summary")
    .eq("child_id", childId)
    .eq("status", "mission_confirming")
    .order("last_delivered_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (questionError || !activeQuestion) {
    if (questionError) {
      console.error("[mission/answer] active parent question query failed", {
        childId,
        sessionId,
        error: questionError.message,
      });
    }
    return null;
  }

  const { data: lastKMessage, error: messageError } = await service
    .from("chat_messages")
    .select("content")
    .eq("session_id", sessionId)
    .eq("role", "k")
    .eq("turn_status", "finalized")
    .order("display_sequence", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (messageError) {
    console.error("[mission/answer] last K message query failed", {
      childId,
      sessionId,
      error: messageError.message,
    });
    return null;
  }

  const deliveredText = activeQuestion.confirmation_question_text || activeQuestion.question_text;
  return lastKMessage?.content?.includes(deliveredText)
    ? activeQuestion
    : null;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const isAtomicTurnRequest = req.headers.get("x-mission-turn-api") === "1";
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) {
    console.error("[mission/answer] Unauthorized", { sessionId: undefined });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { sessionId?: string; questionId?: string; answerText?: string; childTurnId?: string };
  try {
    body = await req.json();
  } catch {
    console.error("[mission/answer] Invalid JSON");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sessionId, questionId, answerText, childTurnId } = body;
  if (!sessionId || !questionId || typeof answerText !== "string") {
    console.error("[mission/answer] sessionId, questionId, answerText required", { sessionId, questionId });
    return NextResponse.json({ error: "sessionId, questionId, answerText required" }, { status: 400 });
  }

  // answerText 길이 제한 (500자)
  if (answerText.length > 500) {
    console.error("[mission/answer] answerText too long", { sessionId, questionId });
    return NextResponse.json({ error: "answerText too long (max 500 characters)" }, { status: 400 });
  }

  // 중복 요청 캐시 확인
  if (childTurnId) {
    const cached = getCachedAnswer(childTurnId);
    if (cached !== null) {
      return NextResponse.json(cached);
    }
  }

  const service = createServiceClient();

  // 세션 조회 + 자유대화 세션 거부 (판정 로직은 미션 세션 전용)
  const { data: session, error: sessErr } = await service
    .from("chat_sessions")
    .select("id, session_type, child_id")
    .eq("id", sessionId)
    .single();

  if (sessErr || !session) {
    console.error("[mission/answer] Session query failed:", { sessionId, err: sessErr });
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const authCheck = await requireChildAccess(service, user.id, session.child_id);
  if (!authCheck.allowed) {
    console.error("[mission/answer] Forbidden", { sessionId, userId: user.id });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.session_type !== "mission") {
    console.error("[mission/answer] Not a mission session", { sessionId });
    return NextResponse.json(
      { error: "answer validation is only allowed for mission sessions" },
      { status: 400 }
    );
  }

  const consentBlocked = await checkConsentForChild(session.child_id);
  if (consentBlocked) return consentBlocked;

  const approvalBlocked = await checkApprovalForChild(session.child_id);
  if (approvalBlocked) return approvalBlocked;

  // 068: 방학/개학 이벤트 감지 — consent/approval 가드를 통과한 뒤에만 실행한다(동의
  // 철회·미승인 아이의 답변을 외부 LLM으로 보내거나 DB에 쓰지 않기 위해 반드시 이
  // 위치여야 한다 — claude-review 지적 반영). 답변 처리 흐름과는 독립적으로 실행되며
  // 실패해도 무시된다.
  scheduleVacationEventDetection(service, session.child_id, answerText, sessionId, childTurnId);

  const sessionCheck = await assertMissionSessionActive(service, sessionId);
  if (!sessionCheck.allowed) {
    console.error("[mission/answer] Mission session not active or expired", { sessionId, status: sessionCheck.status });
    const resPayload = { error: sessionCheck.error, code: sessionCheck.code, status: sessionCheck.status, expired: sessionCheck.expired };
    if (childTurnId) setCachedAnswer(childTurnId, resPayload);
    return NextResponse.json(resPayload, { status: sessionCheck.expired ? 403 : 423 });
  }

  // 기능 플래그 및 코호트 체크 (진행상태 로드 전으로 당김)
  const isV2Flag = isQuestionEngineV2Enabled(session.child_id);

  // 1) status만 먼저 단독 조회 — isV2Flag와 무관하게 항상 실행, SAFETY_PAUSED/COMPLETED면 즉시 차단
  const { data: statusRow, error: statusErr } = await service
    .from("mission_progress")
    .select("status")
    .eq("session_id", sessionId)
    .single();

  if (statusErr || !statusRow) {
    console.error("[mission/answer] status query failed:", { sessionId, err: statusErr });
    return NextResponse.json({ error: "Mission progress not found" }, { status: 404 });
  }

  if (statusRow.status === "SAFETY_PAUSED" || statusRow.status === "COMPLETED") {
    console.error("[mission/answer] Mission is already completed or safety paused", { sessionId, status: statusRow.status });
    const resPayload = { error: "Mission is already completed or safety paused", status: statusRow.status };
    if (childTurnId) setCachedAnswer(childTurnId, resPayload);
    return NextResponse.json(resPayload, { status: 423 });
  }

  interface MissionProgressRow {
    session_id: string;
    valid_answer_count: number | null;
    question_ids: string[] | null;
    question_states: Record<string, QuestionState> | null;
    updated_at?: string | null;
    required_valid_count?: number | null;
    engine_version?: string | null;
    clarification_counts?: Record<string, number> | null;
  }

  // 2) 나머지 필드 조회 — required_valid_count, engine_version 상시 포함
  const fields = "session_id, valid_answer_count, question_ids, question_states, required_valid_count, engine_version, clarification_counts";

  // 진행상태 로드
  const { data: progress, error: progErr } = (await service
    .from("mission_progress")
    .select(fields)
    .eq("session_id", sessionId)
    .single()) as unknown as { data: MissionProgressRow | null; error: { message: string } | null };

  if (progErr || !progress) {
    console.error("[mission/answer] progress query failed:", { sessionId, err: progErr });
    return NextResponse.json({ error: "Mission progress not found" }, { status: 404 });
  }

  const isSessionV2 = progress.engine_version === "v2";
  const requiredCount = isSessionV2 ? (progress.required_valid_count ?? 10) : REQUIRED_COUNT;

  const questionIds: string[] = progress.question_ids ?? [];
  if (!questionIds.includes(questionId)) {
    console.error("[mission/answer] questionId not part of this mission", { sessionId, questionId });
    return NextResponse.json({ error: "questionId not part of this mission" }, { status: 400 });
  }

  const states: Record<string, QuestionState> = { ...(progress.question_states ?? {}) };
  const prevState = states[questionId] ?? "pending";
  const sessionParentQuestion = await findParentQuestionDeliveredInSession(
    service,
    session.child_id,
    sessionId,
  );

  if (prevState === "answered") {
    if (sessionParentQuestion) {
      // 이 질문(mission question)은 이전 요청에서 이미 VALID로 기록됐고 이번은 재시도
      // (idempotent) 요청이다 — 그 재시도가 실은 재확인 라운드로 이어지는 자연스러운
      // 흐름이므로, "confirmed"로 임의 확정하지 않고 §6.1과 동일한 재확인 규칙을 적용한다.
      let parentUpdate = computeParentQuestionLifecycleUpdate({
        confirmationQuestionText: sessionParentQuestion.confirmation_question_text,
        missionConfirmAttempts: sessionParentQuestion.mission_confirm_attempts ?? 0,
        classification: "VALID",
        answerText,
      });
      parentUpdate = await finalizeParentAnswerSummaryIfConfirmed(
        parentUpdate,
        sessionParentQuestion,
        sessionParentQuestion.child_answer_summary || answerText,
      );
      const { error: finalizeError } = await service
        .from("parent_questions")
        .update(parentUpdate)
        .eq("id", sessionParentQuestion.id)
        .eq("status", "mission_confirming");
      if (finalizeError) {
        console.error("[mission/answer] duplicate answer parent lifecycle repair failed", {
          sessionId,
          parentQuestionId: sessionParentQuestion.id,
          error: finalizeError.message,
        });
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }
    }
    const resPayload = {
      valid: true,
      reason: "already_answered",
      refused: false,
      previousState: prevState,
      questionState: "answered",
      validAnswerCount: progress.valid_answer_count ?? 0,
      progressPercent: (progress.valid_answer_count ?? 0) * (isSessionV2 ? 10 : 20),
      requiredCount: requiredCount,
      completed: (progress.valid_answer_count ?? 0) >= requiredCount,
      newlyCompleted: false,
      progressStatus: statusRow.status,
      engine_version: progress.engine_version ?? "v1",
      questionStates: states,
      rewardStatus: "none",
    };
    console.log("[mission/answer] done", { sessionId, classification: "ALREADY_ANSWERED", valid: true, validAnswerCount: resPayload.validAnswerCount, durationMs: Date.now() - startedAt });
    if (childTurnId) setCachedAnswer(childTurnId, resPayload);
    return NextResponse.json(resPayload);
  }

  if (isSessionV2) {
    // ------------------ 신규 V2 질문엔진 로직 ------------------
    
    // 현재까지 asked_order가 세팅된 행의 개수 조회
    const { count: askedCount, error: askedCountErr } = await service
      .from("mission_question_history")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .not("asked_order", "is", null);

    if (askedCountErr) {
      console.error("[mission/answer] Failed to count asked_order:", { sessionId, questionId, err: askedCountErr });
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    // 해당 질문의 사전선택 행을 찾아서 asked_order와 asked_at을 업데이트
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
      console.error("[mission/answer] Failed to update asked_order and asked_at:", { sessionId, questionId, err: updOrderErr });
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    // 질문 텍스트 조회
    const { data: qData, error: qDataErr } = await service
      .from("mission_questions")
      .select("question_text")
      .eq("id", questionId)
      .single();
    
    if (qDataErr) {
      console.error("[mission/answer] Failed to fetch question text:", { sessionId, questionId, err: qDataErr });
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
    let questionText = qData?.question_text ?? "";

    // 부모 질문 주입 여부 확인
    const activeParentQ = sessionParentQuestion;
    const isParentQuestion = !!activeParentQ;
    if (activeParentQ) questionText = activeParentQ.question_text;

    let classification: string;
    let clarificationText: string | undefined = undefined;
    const lowerAns = answerText.trim().toLowerCase();
    const cleanAns = lowerAns.replace(/\s+|[.!?]/g, "");
    if (!cleanAns) {
      classification = "NO_RESPONSE";
    } else if (/^(안해|싫어|응|아니|네|아니요|웅|응응)$/.test(cleanAns)) {
      classification = "VALID";
    } else {
      const clsResult = await classifyAnswer(questionText, answerText, { perAttemptTimeoutMs: 5_000 });
      classification = clsResult.classification;
      clarificationText = clsResult.clarificationText;
    }
    console.log("[mission/answer] classify", { sessionId, questionId, classification });

    if (classification === "CLARIFICATION_NEEDED") {
      const counts = progress.clarification_counts || {};
      const currentCount = counts[questionId] || 0;
      
      if (currentCount >= 1) {
        classification = "NO_RESPONSE"; // fallback to failure if already clarified once
      } else {
        counts[questionId] = 1;
        await service.from("mission_progress").update({ clarification_counts: counts }).eq("session_id", sessionId);
        
        if (childTurnId) {
          await service.from("chat_messages").update({ is_clarification: true }).eq("session_id", sessionId).eq("turn_id", childTurnId);
        }

        const resPayload = {
          valid: false,
          reason: "clarification_needed",
          refused: false,
          previousState: prevState,
          questionState: "clarification_required" as const,
          clarificationText: clarificationText,
          validAnswerCount: progress.valid_answer_count ?? 0,
          progressPercent: (progress.valid_answer_count ?? 0) * 10,
          requiredCount: requiredCount,
          completed: false,
          engine_version: "v2",
          questionStates: { ...states, [questionId]: "clarification_required" as const },
        };
        
        console.log("[mission/answer] clarification required", { sessionId, questionId });
        if (childTurnId) setCachedAnswer(childTurnId, resPayload);
        return NextResponse.json(resPayload);
      }
    }

    // 1. SAFETY_SIGNAL 판정 시 즉시 중단 처리 (RPC 호출로 일괄 대체)
    if (classification === "SAFETY_SIGNAL") {
      const reaction = pickReaction(answerText);
      
      const { data: rpcData, error: rpcErr } = await service.rpc("record_v2_safety_pause", {
        p_session_id: sessionId,
        p_child_id: session.child_id,
        p_question_id: questionId,
        p_answer_text: answerText,
        p_safety_subcategory: reaction.safetySubcategory || "violence",
      });

      if (rpcErr || !rpcData || rpcData.length === 0) {
        console.error("[mission/answer] record_v2_safety_pause RPC error:", { sessionId, questionId, err: rpcErr });
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }

      const rpcResult = rpcData[0] as { blocked: boolean; history_id: string };

      if (rpcResult.blocked) {
        console.error("[mission/answer] Blocked by safety pause", { sessionId, questionId });
        const resPayload = { error: "Mission is already completed or safety paused", status: "SAFETY_PAUSED" };
        if (childTurnId) setCachedAnswer(childTurnId, resPayload);
        return NextResponse.json(resPayload, { status: 423 });
      }

      if (isParentQuestion && activeParentQ) {
        const parentUpdate = computeParentQuestionLifecycleUpdate({
          confirmationQuestionText: activeParentQ.confirmation_question_text,
          missionConfirmAttempts: activeParentQ.mission_confirm_attempts ?? 0,
          classification: "SAFETY_SIGNAL",
          answerText,
        });
        const { error: parentLifecycleError } = await service
          .from("parent_questions")
          .update(parentUpdate)
          .eq("id", activeParentQ.id)
          .eq("status", "mission_confirming");
        if (parentLifecycleError) {
          console.error("[mission/answer] safety parent lifecycle update failed", {
            sessionId,
            parentQuestionId: activeParentQ.id,
            error: parentLifecycleError.message,
          });
          return NextResponse.json({ error: "Database error" }, { status: 500 });
        }
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

      console.log("[mission/answer] done", { sessionId, classification, valid: resPayload.valid, validAnswerCount: resPayload.validAnswerCount, durationMs: Date.now() - startedAt });
      if (childTurnId) setCachedAnswer(childTurnId, resPayload);
      return NextResponse.json(resPayload);
    }

    let questionPoolExhausted = false;
    let newState: QuestionState;
    let answerStatus: "answered" | "skipped" | "refused";
    let finalQuestionIds: string[] | undefined = undefined;
    let finalQuestions: any[] | undefined = undefined;

    if (classification === "VALID") {
      newState = "answered";
      answerStatus = "answered";
    } else {
      const { count: priorFailureCount, error: priorFailureErr } = await service
        .from("mission_question_history")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sessionId)
        .eq("question_id", questionId)
        .in("answer_status", ["skipped", "refused"]);

      if (priorFailureErr) {
        console.error("[mission/answer] Failed to count prior failures:", { sessionId, questionId, err: priorFailureErr });
      }

      const isRepeatedFailure = (priorFailureCount ?? 0) >= 1;

      if (isParentQuestion && activeParentQ) {
        // A parent question is asked once in the selected mission. An invalid
        // answer ends this delivery as incomplete instead of immediately
        // repeating or leaking into the next mission.
        newState = "refused";
        answerStatus = "refused";
      } else {
        if (isRepeatedFailure) {
          newState = "refused";
          answerStatus = "refused";
        } else {
          newState = "skipped";
          answerStatus = "skipped";
        }
      }
    }

    // VALID/REFUSAL/NO_RESPONSE 판정 시 record_v2_mission_answer RPC 호출
    const { data: rpcData, error: rpcErr } = await service.rpc(
      isAtomicTurnRequest ? "record_v2_mission_answer_pending" : "record_v2_mission_answer",
      {
      p_session_id: sessionId,
      p_child_id: session.child_id,
      p_question_id: questionId,
      p_answer_status: answerStatus,
      p_answer_classification: classification,
      p_required_valid_count: requiredCount,
      p_reward_type: "mission_complete",
      }
    );

    if (rpcErr || !rpcData || rpcData.length === 0) {
      console.error("[mission/answer] record_v2_mission_answer RPC error:", { sessionId, questionId, err: rpcErr });
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

    console.log("[mission/answer] progress update", { sessionId, questionId, classification, prevCount: progress.valid_answer_count ?? 0, newCount: rpcResult.valid_answer_count });

    if (rpcResult.blocked) {
      console.error("[mission/answer] Blocked after answer RPC", { sessionId, questionId, status: rpcResult.status });
      const resPayload = { error: "Mission is already completed or safety paused", status: rpcResult.status };
      if (childTurnId) setCachedAnswer(childTurnId, resPayload);
      return NextResponse.json(resPayload, { status: 423 });
    }

    if (isParentQuestion && activeParentQ) {
      let parentUpdate = computeParentQuestionLifecycleUpdate({
        confirmationQuestionText: activeParentQ.confirmation_question_text,
        missionConfirmAttempts: activeParentQ.mission_confirm_attempts ?? 0,
        classification,
        answerText,
      });
      // "confirmed"로 확정되는 순간 — 재확인 라운드 동안 보관해온 원문(activeParentQ의
      // 기존 child_answer_summary, 이번 턴은 "응/맞아" 같은 확인 응답일 뿐 원문이 아님)을
      // 부모 노출용 3인칭 요약으로 순화한다.
      parentUpdate = await finalizeParentAnswerSummaryIfConfirmed(
        parentUpdate,
        activeParentQ,
        activeParentQ.child_answer_summary || answerText,
      );

      const { error: parentLifecycleError } = await service
        .from("parent_questions")
        .update(parentUpdate)
        .eq("id", activeParentQ.id)
        .eq("status", "mission_confirming");

      if (parentLifecycleError) {
        console.error("[mission/answer] parent lifecycle update failed", {
          sessionId,
          parentQuestionId: activeParentQ.id,
          classification,
          error: parentLifecycleError.message,
        });
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }
    }

    if (rpcResult.newly_completed) {
      const { data: childData } = await service.from("child_profiles").select("family_id").eq("id", session.child_id).single();
      await logBehaviorEvent({
        eventName: "mission_complete",
        actorType: "child",
        childId: session.child_id,
        familyId: childData?.family_id,
        sessionId,
        feature: "mission",
        route: "/api/mission/answer",
      }).catch(() => {});
    }

    const finalQuestionStates = { ...rpcResult.question_states };

    // 실패(skipped/refused)인 경우 예비질문 승격 로직
    // 무효 처리(refused - 2번째 이상 실패)인 경우에만 예비질문 승격을 시도한다.
    if (newState === "refused") {
      try {
        const { data: reserveList, error: reserveErr } = await service
          .from("mission_question_history")
          .select("id, question_id, selected_order")
          .eq("child_id", session.child_id)
          .eq("session_id", sessionId)
          .eq("question_role", "RESERVE")
          .is("asked_order", null)
          .order("selected_order", { ascending: true })
          .limit(5);

        if (reserveErr) {
          throw new Error(`Failed to query reserve questions: ${reserveErr.message}`);
        }

        if (reserveList && reserveList.length > 0) {
          const vCtx = await getActiveVacationContext(service, session.child_id);
          const blocked = resolveSchoolQuestionBlockState(vCtx, getKstBusinessDate()).blocked;
          const candidateIds = reserveList.map(r => r.question_id);
          const chosenId = await pickNonSchoolQuestionId(service, candidateIds, blocked);
          const reserveQ = reserveList.find(r => r.question_id === chosenId) ?? reserveList[0];
          
          // 현재 질문의 selected_order 조회
          const { data: failedQ, error: failedQErr } = await service
            .from("mission_question_history")
            .select("selected_order")
            .eq("child_id", session.child_id)
            .eq("session_id", sessionId)
            .eq("question_id", questionId)
            .not("question_role", "is", null)
            .order("selected_order", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (failedQErr) {
            throw new Error(`Failed to query failed question order: ${failedQErr.message}`);
          }

          const currentOrder = failedQ?.selected_order ?? 0;

          // 이후의 selected_order들 1씩 밀기
          const { data: shiftList, error: shiftListErr } = await service
            .from("mission_question_history")
            .select("id, selected_order")
            .eq("child_id", session.child_id)
            .eq("session_id", sessionId)
            .gt("selected_order", currentOrder);

          if (shiftListErr) {
            throw new Error(`Failed to query shift list: ${shiftListErr.message}`);
          }

          if (shiftList) {
            for (const row of shiftList) {
              const { error: shiftErr } = await service
                .from("mission_question_history")
                .update({ selected_order: row.selected_order + 1 })
                .eq("id", row.id);

              if (shiftErr) {
                throw new Error(`Failed to update shift order: ${shiftErr.message}`);
              }
            }
          }

          // RESERVE -> PRIMARY 승격 및 순서 삽입
          const { error: promoteErr } = await service
            .from("mission_question_history")
            .update({
              question_role: "PRIMARY",
              selected_order: currentOrder + 1,
              asked_at: new Date().toISOString(),
            })
            .eq("id", reserveQ.id);

          if (promoteErr) {
            throw new Error(`Failed to promote reserve question: ${promoteErr.message}`);
          }

          // progress.question_ids 정렬 갱신
          const { data: sortedList, error: sortedErr } = await service
            .from("mission_question_history")
            .select("question_id")
            .eq("child_id", session.child_id)
            .eq("session_id", sessionId)
            .not("question_role", "is", null)
            .order("selected_order", { ascending: true });

          if (sortedErr) {
            throw new Error(`Failed to query sorted questions: ${sortedErr.message}`);
          }

          if (sortedList) {
            const sortedIds = sortedList.map((h) => h.question_id);
            finalQuestionStates[reserveQ.question_id] = "pending";
            finalQuestionIds = sortedIds;

            console.log("[mission/answer] progress update", { sessionId, questionId, classification, prevCount: progress.valid_answer_count ?? 0, newCount: rpcResult.valid_answer_count });
            const { error: updateIdsErr } = await service
              .from("mission_progress")
              .update({
                question_ids: sortedIds,
                question_states: finalQuestionStates,
              })
              .eq("session_id", sessionId);

            if (updateIdsErr) {
              throw new Error(`Failed to update sorted ids in progress: ${updateIdsErr.message}`);
            }
          }
        } else {
          // 예비 문항이 하나도 없다 - 미션에서 이미 쓰인 모든 문항을 제외하고 즉시
          // 1개를 추가로 찾아 RESERVE로 승격 시도한다.
          const usedIds: string[] = progress.question_ids ?? [];
          const { data: childProfile } = await service
            .from("child_profiles")
            .select("grade")
            .eq("id", session.child_id)
            .maybeSingle();
          const { data: progressRoundType } = await service
            .from("mission_progress")
            .select("round_type")
            .eq("session_id", sessionId)
            .maybeSingle();

          const realGradeNum = parseGrade(childProfile?.grade);
          const gradeNum = realGradeNum !== null ? getEffectiveContentGrade(realGradeNum) : null;
          const roundTypeVal = progressRoundType?.round_type;

          let backfillIds: string[] = [];
          if (gradeNum && roundTypeVal) {
            try {
              backfillIds = await selectAdditionalReserveQuestions(session.child_id, gradeNum, roundTypeVal as any, usedIds, 5);
            } catch (e) {
              console.error("[answer/route] mid-session reserve backfill failed:", e);
            }
          }

          if (backfillIds.length === 0) {
            console.error("[answer/route] MISSION_QUESTION_POOL_EXHAUSTED", {
              sessionId, questionId, childId: session.child_id,
            });
            questionPoolExhausted = true;
          } else {
            const vCtx = await getActiveVacationContext(service, session.child_id);
            const blocked = resolveSchoolQuestionBlockState(vCtx, getKstBusinessDate()).blocked;
            const chosenId = await pickNonSchoolQuestionId(service, backfillIds, blocked);

            const { data: insertedReserve, error: insertReserveErr } = await service
              .from("mission_question_history")
              .insert({
                child_id: session.child_id,
                question_id: chosenId,
                question_role: "RESERVE",
                selected_order: 9999,
                session_id: sessionId,
              })
              .select("id, question_id, selected_order")
              .single();

            if (insertReserveErr || !insertedReserve) {
              console.error("[answer/route] Failed to insert backfilled reserve question:", insertReserveErr);
              questionPoolExhausted = true;
            } else {
              const reserveQ = insertedReserve;
              
              // 현재 질문의 selected_order 조회
              const { data: failedQ, error: failedQErr } = await service
                .from("mission_question_history")
                .select("selected_order")
                .eq("child_id", session.child_id)
                .eq("session_id", sessionId)
                .eq("question_id", questionId)
                .not("question_role", "is", null)
                .order("selected_order", { ascending: false })
                .limit(1)
                .maybeSingle();

              if (failedQErr) {
                throw new Error(`Failed to query failed question order: ${failedQErr.message}`);
              }

              const currentOrder = failedQ?.selected_order ?? 0;

              // 이후의 selected_order들 1씩 밀기
              const { data: shiftList, error: shiftListErr } = await service
                .from("mission_question_history")
                .select("id, selected_order")
                .eq("child_id", session.child_id)
                .eq("session_id", sessionId)
                .gt("selected_order", currentOrder);

              if (shiftListErr) {
                throw new Error(`Failed to query shift list: ${shiftListErr.message}`);
              }

              if (shiftList) {
                for (const row of shiftList) {
                  const { error: shiftErr } = await service
                    .from("mission_question_history")
                    .update({ selected_order: row.selected_order + 1 })
                    .eq("id", row.id);

                  if (shiftErr) {
                    throw new Error(`Failed to update shift order: ${shiftErr.message}`);
                  }
                }
              }

              // RESERVE -> PRIMARY 승격 및 순서 삽입
              const { error: promoteErr } = await service
                .from("mission_question_history")
                .update({
                  question_role: "PRIMARY",
                  selected_order: currentOrder + 1,
                  asked_at: new Date().toISOString(),
                })
                .eq("id", reserveQ.id);

              if (promoteErr) {
                throw new Error(`Failed to promote reserve question: ${promoteErr.message}`);
              }

              // progress.question_ids 정렬 갱신
              const { data: sortedList, error: sortedErr } = await service
                .from("mission_question_history")
                .select("question_id")
                .eq("child_id", session.child_id)
                .eq("session_id", sessionId)
                .not("question_role", "is", null)
                .order("selected_order", { ascending: true });

              if (sortedErr) {
                throw new Error(`Failed to query sorted questions: ${sortedErr.message}`);
              }

              if (sortedList) {
                const sortedIds = sortedList.map((h) => h.question_id);
                finalQuestionStates[reserveQ.question_id] = "pending";
                finalQuestionIds = sortedIds;

                console.log("[mission/answer] progress update", { sessionId, questionId, classification, prevCount: progress.valid_answer_count ?? 0, newCount: rpcResult.valid_answer_count });
                const { error: updateIdsErr } = await service
                  .from("mission_progress")
                  .update({
                    question_ids: sortedIds,
                    question_states: finalQuestionStates,
                  })
                  .eq("session_id", sessionId);

                if (updateIdsErr) {
                  throw new Error(`Failed to update sorted ids in progress: ${updateIdsErr.message}`);
                }
              }
            }
          }
        }
      } catch (e: any) {
        console.error("[answer/route] reserve promotion failed (non-fatal, answer already committed):", e);
      }
    }

    if (finalQuestionIds) {
      const { data: updatedQuestions, error: qErr } = await service
        .from("mission_questions")
        .select("id, question_text, dashboard_area_tag, cycle_type, round_type")
        .in("id", finalQuestionIds);
      if (!qErr && updatedQuestions) {
        finalQuestions = finalQuestionIds
          .map((qid) => updatedQuestions.find((q) => q.id === qid))
          .filter(Boolean);
      }
    }

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
      questionPoolExhausted,
      ...(finalQuestionIds && finalQuestions ? { questionIds: finalQuestionIds, questions: finalQuestions } : {}),
    };

    console.log("[mission/answer] done", { sessionId, classification, valid: resPayload.valid, validAnswerCount: resPayload.validAnswerCount, durationMs: Date.now() - startedAt });
    if (childTurnId) setCachedAnswer(childTurnId, resPayload);
    return NextResponse.json(resPayload);
  }

  // ------------------ 기존 V1 질문엔진 로직 ------------------

  // 부모 질문 주입 여부 확인 (V2와 동일한 규칙 재사용 — respond/route.ts는 엔진 버전과
  // 무관하게 parent_questions를 주입하므로, V1 세션에서 답변이 들어와도 동일하게
  // confirmed/declined/mission_incomplete 상태 전이를 반영해야 한다)
  const activeParentQV1 = sessionParentQuestion;
  const isParentQuestionV1 = !!activeParentQV1;

  // 유효성 판정
  const result = validateAnswer(answerText);

  let newState: QuestionState;
  let answerStatus: "answered" | "skipped" | "refused";

  async function applyV1ParentLifecycle(classificationForV1: "VALID" | "REFUSAL" | "NO_RESPONSE") {
    if (!isParentQuestionV1 || !activeParentQV1) return;
    let parentUpdate = computeParentQuestionLifecycleUpdate({
      confirmationQuestionText: activeParentQV1.confirmation_question_text,
      missionConfirmAttempts: activeParentQV1.mission_confirm_attempts ?? 0,
      classification: classificationForV1,
      answerText: answerText ?? "",
    });
    parentUpdate = await finalizeParentAnswerSummaryIfConfirmed(
      parentUpdate,
      activeParentQV1,
      activeParentQV1.child_answer_summary || answerText || "",
    );
    const { error: lifecycleError } = await service
      .from("parent_questions")
      .update(parentUpdate)
      .eq("id", activeParentQV1.id)
      .eq("status", "mission_confirming");
    if (lifecycleError) {
      console.error("[mission/answer] V1 parent lifecycle update failed", {
        sessionId,
        parentQuestionId: activeParentQV1.id,
        classificationForV1,
        error: lifecycleError.message,
      });
      throw new Error("Database error");
    }
  }

  let clarificationTextV1: string | undefined = undefined;

  if (result.needsClarification) {
    const counts = progress.clarification_counts || {};
    const currentCount = counts[questionId] || 0;
    
    if (currentCount >= 1) {
      newState = "skipped";
      answerStatus = "skipped";
      try {
        await applyV1ParentLifecycle("NO_RESPONSE");
      } catch {
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }
    } else {
      counts[questionId] = 1;
      
      const { data: qData } = await service
        .from("mission_questions")
        .select("question_text")
        .eq("id", questionId)
        .single();
      const questionTextV1 = qData?.question_text ?? "";
      
      const bgClassResult = await classifyAnswer(questionTextV1, answerText, { perAttemptTimeoutMs: 5_000 });
      clarificationTextV1 = bgClassResult.clarificationText;

      const resPayload = {
        valid: false,
        reason: "clarification_needed",
        refused: false,
        previousState: prevState,
        questionState: "clarification_required" as const,
        clarificationText: clarificationTextV1,
        validAnswerCount: progress.valid_answer_count ?? 0,
        progressPercent: (progress.valid_answer_count ?? 0) * 20,
        requiredCount: REQUIRED_COUNT,
        completed: false,
        engine_version: "v1",
        questionStates: { ...states, [questionId]: "clarification_required" as const },
      };
      
      await service.from("mission_progress").update({ clarification_counts: counts }).eq("session_id", sessionId);

      if (childTurnId) {
        await service.from("chat_messages").update({ is_clarification: true }).eq("session_id", sessionId).eq("turn_id", childTurnId);
      }

      console.log("[mission/answer] clarification required", { sessionId, questionId });
      if (childTurnId) setCachedAnswer(childTurnId, resPayload);
      return NextResponse.json(resPayload);
    }
  } else if (result.valid) {
    newState = "answered";
    answerStatus = "answered";
    try {
      await applyV1ParentLifecycle("VALID");
    } catch {
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
  } else if (result.refused) {
    newState = "refused";
    answerStatus = "refused";
    try {
      await applyV1ParentLifecycle("REFUSAL");
    } catch {
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
  } else {
    // 무응답/회피/오답 → 완료처리 없이 skipped (전체 순회 후 루프백 대상)
    newState = "skipped";
    answerStatus = "skipped";
    try {
      await applyV1ParentLifecycle("NO_RESPONSE");
    } catch {
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
  }

  states[questionId] = newState;

  // valid_answer_count 재계산 (answered 상태 개수, 최대 questionIds 길이)
  const validCount = Object.entries(states).filter(
    ([qid, st]) => questionIds.includes(qid) && st === "answered"
  ).length;

  // 출제이력 기록 (이번 답변)
  await service.from("mission_question_history").insert({
    child_id: session.child_id,
    question_id: questionId,
    answer_status: answerStatus,
  });

    let currentProgressV1 = progress;
    let currentStatesV1 = states;
    let successV1 = false;
    let finalValidCountV1 = validCount;

    for (let attempt = 0; attempt < 3; attempt++) {
      const updatePayload = {
        question_states: currentStatesV1,
        valid_answer_count: finalValidCountV1,
        updated_at: new Date().toISOString(),
      };

      console.log("[mission/answer] progress update", { sessionId, questionId, classification: answerStatus, prevCount: currentProgressV1.valid_answer_count ?? 0, newCount: finalValidCountV1 });

      let query = service
        .from("mission_progress")
        .update(updatePayload)
        .eq("session_id", sessionId);

      if (currentProgressV1.valid_answer_count === null) {
        query = query.is("valid_answer_count", null);
      } else {
        query = query.eq("valid_answer_count", currentProgressV1.valid_answer_count);
      }

      const { data: updatedRows, error: updErr } = await query.select("session_id");

      if (updErr) {
        console.error(`[mission/answer] V1 progress update failed (attempt ${attempt + 1}):`, { sessionId, questionId, err: updErr });
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }

      if (updatedRows && updatedRows.length > 0) {
        successV1 = true;
        break;
      }

      console.warn(`[mission/answer] V1 optimistic lock conflict. Retrying... (attempt ${attempt + 1})`, { sessionId, questionId });

      const { data: latestProgressV1, error: fetchErr } = await service
        .from("mission_progress")
        .select("session_id, valid_answer_count, question_ids, question_states")
        .eq("session_id", sessionId)
        .single();

      if (fetchErr || !latestProgressV1) {
        console.error("[mission/answer] V1 failed to refetch progress during retry:", { sessionId, questionId, err: fetchErr });
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }

      currentProgressV1 = latestProgressV1;
      currentStatesV1 = { ...(latestProgressV1.question_states ?? {}), [questionId]: newState };
      
      finalValidCountV1 = Object.entries(currentStatesV1).filter(
        ([qid, st]) => questionIds.includes(qid) && st === "answered"
      ).length;
    }

    if (!successV1) {
        console.error("[mission/answer] V1 progress update failed after 3 attempts due to conflict.", { sessionId, questionId });
        return NextResponse.json({ error: "Transaction conflict, please try again" }, { status: 409 });
    }

  const wasCompleted = (progress.valid_answer_count ?? 0) >= REQUIRED_COUNT;
  const completed = validCount >= REQUIRED_COUNT;

  // 분석 이벤트 전용 완료 판정 — optimistic lock 재시도가 있었다면(currentProgressV1/
  // finalValidCountV1이 latestProgressV1 기준으로 갱신됨) 그 실제로 반영된 값을 기준으로
  // 판단한다. 재시도가 없었다면 progress/validCount와 동일한 값이라 결과는 같다. 위의
  // wasCompleted/completed(황금열쇠 적립 판정, 기존 로직)는 이 분석 이벤트와 무관하게
  // 그대로 둔다 — 재시도 경합 시의 정합성은 이번 작업 범위(분석 계측) 밖의 별도 이슈다.
  const trueWasCompleted = (currentProgressV1.valid_answer_count ?? 0) >= REQUIRED_COUNT;
  const trueCompleted = finalValidCountV1 >= REQUIRED_COUNT;
  if (trueCompleted && !trueWasCompleted) {
    const { data: childData } = await service.from("child_profiles").select("family_id").eq("id", session.child_id).single();
    await logBehaviorEvent({
      eventName: "mission_complete",
      actorType: "child",
      childId: session.child_id,
      familyId: childData?.family_id,
      sessionId,
      feature: "mission",
      route: "/api/mission/answer",
    }).catch(() => {});
    await recordMissionOnboardingCompletion(service, session.child_id, sessionId);
  }

  // 게이지 5칸 최초 달성 시점에만 황금열쇠 적립 (재호출로 중복 적립 방지) — 기존 로직 그대로.
  // rewardStatus는 게이트①(claude-review) C2 지적 대응: 지급 결과를 resPayload에 실어
  // 보내지 않으면 클라이언트가 완료=지급성공으로 단정해(app/child/missions/page.tsx의
  // isLegacyV1 기본값) 하루 1회 제한으로 실제로는 막힌 지급도 "받았어요"로 오표시된다.
  let v1RewardStatus: string | undefined;
  if (completed && !wasCompleted && !isAtomicTurnRequest) {
    try {
      const goldKeyResult = await earnMissionCompleteKey(session.child_id, sessionId);
      if (goldKeyResult.earned) {
        v1RewardStatus = "awarded";
      } else if (goldKeyResult.reason) {
        v1RewardStatus = goldKeyResult.reason;
      } else {
        throw new Error("unknown_error");
      }
    } catch (e) {
      console.error("[answer/route] V1 earnMissionCompleteKey error:", e);
      // 실제 지급 여부를 알 수 없는 오류이므로 v1RewardStatus를 "awarded"로
      // 단정하지 않는다 — 아래 resPayload 구성부의 `?? "unknown"` 폴백이 처리한다.
    }
  }

  const resPayload = {
    valid: result.valid,
    reason: result.reason ?? null,
    refused: result.refused ?? false,
    previousState: prevState,
    questionState: newState,
    validAnswerCount: validCount,   // 게이지 0~5
    progressPercent: validCount * 20,
    requiredCount: REQUIRED_COUNT,
    completed,
    engine_version: "v1",
    questionStates: states,
    // 게이트①r2(claude-review) F1 지적: v1RewardStatus가 undefined면
    // JSON.stringify가 키 자체를 응답에서 제거해, 클라이언트의
    // `data.rewardStatus ?? (isLegacyV1 ? "awarded" : "none")` 폴백이
    // "awarded"로 오표시한다. "unknown"은 AWARDED_STATUSES에 없어
    // missionRewardPresentation.ts의 안전한 기본 분기로 떨어진다.
    rewardStatus: v1RewardStatus ?? "unknown",
  };

  console.log("[mission/answer] done", { sessionId, classification: answerStatus, valid: resPayload.valid, validAnswerCount: resPayload.validAnswerCount, durationMs: Date.now() - startedAt });
  if (childTurnId) setCachedAnswer(childTurnId, resPayload);
  return NextResponse.json(resPayload);
}
