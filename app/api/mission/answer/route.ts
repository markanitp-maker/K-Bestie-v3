import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { validateAnswer } from "@/lib/mission/validateAnswer";
import { earnMissionCompleteKey } from "@/lib/goldkey/ledger";
import { checkConsentForChild } from "@/lib/plan/consentGuard";
import { isQuestionEngineV2Enabled } from "@/lib/questions/feature-flags";
import { classifyAnswer } from "@/lib/questions/answer-classifier";
import { pickReaction } from "@/lib/freeChatReactions";

// 컬럼 정의 통일:
// - answer_status: 레거시 상태값(answered/skipped/refused). UI 하위호환을 위해 계속 기록되지만 더 이상 진행률 판정의 권위값이 아니다.
// - answer_classification: 질문 엔진 V2의 최종 판정 source of truth(VALID/PARTIAL/REFUSAL/NO_RESPONSE/SAFETY_SIGNAL). progress_awarded와 함께 서버 진행률 계산의 기준이 된다.
// - progress_awarded: 이 답변이 실제로 진행률에 반영됐는지 여부(boolean).

import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";

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

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
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
  if (consentBlocked) {
    console.error("[mission/answer] Consent blocked", { sessionId });
    return consentBlocked;
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
  }

  // 2) 나머지 필드 조회 — required_valid_count, engine_version 상시 포함
  const fields = "session_id, valid_answer_count, question_ids, question_states, required_valid_count, engine_version";

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

  if (prevState === "answered") {
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
    const questionText = qData?.question_text ?? "";

    let classification: string;
    const lowerAns = answerText.trim().toLowerCase();
    const cleanAns = lowerAns.replace(/\s+|[.!?]/g, "");
    if (!cleanAns) {
      classification = "NO_RESPONSE";
    } else if (/^(몰라|모르겠어|안해|싫어|응|아니|네|아니요|웅|응응)$/.test(cleanAns)) {
      classification = "VALID";
    } else {
      classification = await classifyAnswer(questionText, answerText);
    }
    console.log("[mission/answer] classify", { sessionId, questionId, classification });

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

    let newState: QuestionState;
    let answerStatus: "answered" | "skipped" | "refused";

    if (classification === "VALID") {
      newState = "answered";
      answerStatus = "answered";
    } else if (classification === "REFUSAL") {
      newState = "refused";
      answerStatus = "refused";
    } else {
      newState = "skipped";
      answerStatus = "skipped";
    }

    // VALID/REFUSAL/NO_RESPONSE 판정 시 record_v2_mission_answer RPC 호출
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
    if (newState === "skipped" || newState === "refused") {
      try {
        const { data: reserveList, error: reserveErr } = await service
          .from("mission_question_history")
          .select("id, question_id, selected_order")
          .eq("child_id", session.child_id)
          .eq("session_id", sessionId)
          .eq("question_role", "RESERVE")
          .is("asked_order", null)
          .order("selected_order", { ascending: true })
          .limit(1);

        if (reserveErr) {
          throw new Error(`Failed to query reserve questions: ${reserveErr.message}`);
        }

        if (reserveList && reserveList.length > 0) {
          const reserveQ = reserveList[0];
          
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
      } catch (e: any) {
        console.error("[answer/route] reserve promotion failed (non-fatal, answer already committed):", e);
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
    };

    console.log("[mission/answer] done", { sessionId, classification, valid: resPayload.valid, validAnswerCount: resPayload.validAnswerCount, durationMs: Date.now() - startedAt });
    if (childTurnId) setCachedAnswer(childTurnId, resPayload);
    return NextResponse.json(resPayload);
  }

  // ------------------ 기존 V1 질문엔진 로직 ------------------
  
  // 유효성 판정
  const result = validateAnswer(answerText);

  let newState: QuestionState;
  let answerStatus: "answered" | "skipped" | "refused";
  if (result.valid) {
    newState = "answered";
    answerStatus = "answered";
  } else if (result.refused) {
    newState = "refused";
    answerStatus = "refused";
  } else {
    // 무응답/회피/오답 → 완료처리 없이 skipped (전체 순회 후 루프백 대상)
    newState = "skipped";
    answerStatus = "skipped";
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
  }

  // 게이지 5칸 최초 달성 시점에만 황금열쇠 적립 (재호출로 중복 적립 방지) — 기존 로직 그대로.
  if (completed && !wasCompleted) {
    try {
      const goldKeyResult = await earnMissionCompleteKey(session.child_id);
      if (!goldKeyResult.earned && goldKeyResult.reason !== "already_earned") {
        throw new Error(goldKeyResult.reason || "unknown_error");
      }
    } catch (e) {
      console.error("[answer/route] V1 earnMissionCompleteKey error:", e);
      // 적립 실패는 미션 완료 응답 자체를 막지 않음 (열쇠는 부가 보상)
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
  };

  console.log("[mission/answer] done", { sessionId, classification: answerStatus, valid: resPayload.valid, validAnswerCount: resPayload.validAnswerCount, durationMs: Date.now() - startedAt });
  if (childTurnId) setCachedAnswer(childTurnId, resPayload);
  return NextResponse.json(resPayload);
}
