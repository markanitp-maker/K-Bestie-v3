import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { selectQuestions, selectQuestionsV2, parseGrade, countApprovedV2Candidates, REQUIRED_COUNT_V2, TOTAL_COUNT_V2, type RoundType } from "@/lib/mission/selectQuestions";
import { getVoiceModeForChild } from "@/lib/plan/voiceMode";
import { checkConsentForChild } from "@/lib/plan/consentGuard";
import { isQuestionEngineV2Enabled } from "@/lib/questions/feature-flags";
import { isChildAlphaAllowedForQuestions } from "@/lib/questions/alphaAllowlist";
import { selectAlphaQuestions, selectFixedMissionQuestions, selectAdditionalReserveQuestions, RESERVE_TARGET_COUNT } from "@/lib/mission/selectQuestions";
import { ChildConversationContext } from "@/lib/mission/ChildConversationContext";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";

export const runtime = "nodejs";

const VALID_ROUNDS: RoundType[] = ["round1_day", "round2_night", "common"];

export async function POST(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { childId?: string; roundType?: RoundType };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { childId, roundType } = body;
  if (!childId || !roundType) {
    return NextResponse.json({ error: "childId, roundType required" }, { status: 400 });
  }

  const authCheck = await requireChildAccess(authClient, user.id, childId);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!VALID_ROUNDS.includes(roundType)) {
    return NextResponse.json({ error: "invalid roundType" }, { status: 400 });
  }

  const consentBlocked = await checkConsentForChild(childId);
  if (consentBlocked) return consentBlocked;

  let isV2 = isQuestionEngineV2Enabled(childId);
  const isAlphaQuestionChild = await isChildAlphaAllowedForQuestions(childId);

  const service = createServiceClient();

  const { data: childProfile } = await service
    .from("child_profiles")
    .select("name, given_name, grade")
    .eq("id", childId)
    .maybeSingle();
  const givenName = childProfile?.given_name ?? null;
  const gradeValue = childProfile?.grade;

  const childContext: ChildConversationContext = {
    childId,
    displayName: childProfile?.name ?? "",
    givenName,
    grade: parseGrade(gradeValue) ?? 0,
    knownProfileFacts: {}
  };

  // 요금제(tier)별 음성 방식 — 미션 로직(정답판정/게이지/황금열쇠/라운드)과 무관한 부가 정보
  const { tier, voiceMode, liveVoiceName } = await getVoiceModeForChild(childId);

  // KST 기준 오늘의 시작/끝 시각 계산 (business_date 경계)
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffset);
  const yyyy = kstNow.getUTCFullYear();
  const mm = String(kstNow.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kstNow.getUTCDate()).padStart(2, '0');
  const businessDate = `${yyyy}-${mm}-${dd}`;
  const startOfDayKst = new Date(`${businessDate}T00:00:00+09:00`).toISOString();
  const endOfDayKst = new Date(`${businessDate}T23:59:59.999+09:00`).toISOString();

  // ── 이어하기: KST 기준 오늘(business_date) 생성된, 같은 라운드(window_id)의 가장 최근 세션 조회.
  //
  // 주의(2026-07-25 확인): chat_sessions.ended_at은 미션 완료 시 이 코드베이스 어디에서도 갱신되지
  // 않는다(완료 처리는 mission_progress.status='COMPLETED'만 찍고 chat_sessions는 건드리지 않음 —
  // grep으로 전체 저장소 확인 완료, 유일하게 ended_at을 쓰는 곳은 test-mission 전용 라우트와
  // free 세션 배치뿐). 그래서 과거 "ended_at IS NULL = 활성"이라는 전제 자체가 항상 참이 돼(완료된
  // 미션 세션도 ended_at이 계속 NULL로 남아 있으므로) 완료 세션이 매번 "활성 세션"으로 오인되어
  // 재사용됐다 — 011의 "완료 후 재시작해도 이전 완료 세션을 이어한다" 버그의 실제 원인.
  // ended_at 대신 mission_progress.status로 직접 판정한다: COMPLETED만 "재사용 안 함"(항상 새
  // 세션 시작, 011 임시 정책)으로 취급하고, 그 외(IN_PROGRESS/SAFETY_PAUSED/V1의 null 등)는
  // 기존과 동일하게 이어하기 대상으로 남긴다.
  const { data: todaySessionRow, error: todaySessionErr } = await service
    .from("chat_sessions")
    .select("id, mission_progress!inner(status, valid_answer_count, question_ids, question_states, required_valid_count, engine_version)")
    .eq("child_id", childId)
    .eq("session_type", "mission")
    .gte("started_at", startOfDayKst)
    .lte("started_at", endOfDayKst)
    .eq("mission_progress.round_type", roundType)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (todaySessionErr) {
    console.error("[start/route] todaySession query error:", todaySessionErr);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  let existingSessionRow: typeof todaySessionRow | null = null;
  if (todaySessionRow) {
    const todayProgress = Array.isArray(todaySessionRow.mission_progress)
      ? todaySessionRow.mission_progress[0]
      : todaySessionRow.mission_progress;
    if (todayProgress?.status !== "COMPLETED") {
      existingSessionRow = todaySessionRow;
    }
  }

  if (existingSessionRow) {
    const existingSessionId = existingSessionRow.id;
    // select() 결과로 배열 형태로 내려오거나 단일 객체로 내려옴(has one)
    const existingProgress = Array.isArray(existingSessionRow.mission_progress)
      ? existingSessionRow.mission_progress[0]
      : existingSessionRow.mission_progress;

    if (existingProgress?.status === "SAFETY_PAUSED") {
      return NextResponse.json(
        { error: "Mission is safety paused pending review", status: "SAFETY_PAUSED", sessionId: existingSessionId },
        { status: 423 }
      );
    }

    const isExistingV2 = existingProgress?.engine_version === "v2";
    const reqCount = isExistingV2 ? (existingProgress?.required_valid_count ?? 10) : 5;

    if (existingProgress) {
      const existingIds: string[] = existingProgress.question_ids ?? [];
      const { data: existingQuestions, error: existingQuestionsErr } = await service
        .from("mission_questions")
        .select("id, question_text, dashboard_area_tag, cycle_type, round_type")
        .in("id", existingIds);

      if (existingQuestionsErr) {
        console.error("[start/route] existingQuestions query error:", existingQuestionsErr);
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }

      const orderedExisting = existingIds
        .map((qid) => (existingQuestions ?? []).find((q) => q.id === qid))
        .filter(Boolean);

      const progressPercent = (existingProgress.valid_answer_count ?? 0) * (isExistingV2 ? 10 : 20);
      const isCompleted = existingProgress.status === "COMPLETED" || (existingProgress.valid_answer_count ?? 0) >= reqCount;

      return NextResponse.json({
        resumed: true,
        sessionId: existingSessionId,
        roundType,
        requiredCount: reqCount,
        progressPercent,
        completed: isCompleted,
        engine_version: isExistingV2 ? "v2" : "v1",
        questionIds: existingIds,
        questions: orderedExisting,
        questionStates: existingProgress.question_states ?? {},
        validAnswerCount: existingProgress.valid_answer_count ?? 0,
        tier,
        voiceMode,
        liveVoiceName,
        givenName,
        childContext,
      });
    }
  }

  if (!childProfile) {
    return NextResponse.json({ error: "Child not found" }, { status: 404 });
  }

  const grade = parseGrade(gradeValue);
  if (grade === null) {
    return NextResponse.json({ error: "Cannot parse child grade" }, { status: 400 });
  }

  // 개인화(쿨다운·최근출제) 적용 후 실제 가용 문항이 PRIMARY 10개 + 전체 20개 미만이면 V1 폴백.
  // 미승인·중복(쿨다운 미충족) 문항을 억지로 채워 넣지 않는다 — selectQuestionsV2가 내부적으로
  // 후보 부족 시 쿨다운 미충족 문항까지 강제로 채우는 보정 로직을 갖고 있으므로, 그 보정에 기대지 않고
  // 이 게이트에서 미리 차단한다.
  if (isV2 && !isAlphaQuestionChild) {
    const eligibleCount = await countApprovedV2Candidates(childId, grade, roundType, childContext);
    if (eligibleCount < REQUIRED_COUNT_V2 || eligibleCount < TOTAL_COUNT_V2) {
      console.warn("[start/route] V2->V1 폴백: 개인화 적용 후 가용 문항 부족", {
        childId,
        grade,
        roundType,
        eligibleCount,
        requiredPrimary: REQUIRED_COUNT_V2,
        requiredTotal: TOTAL_COUNT_V2,
        shortfall: TOTAL_COUNT_V2 - eligibleCount,
      });
      isV2 = false;
    }
  }

  // 출제 질문 선별
  let questionIds: string[] = [];
  try {
    questionIds = await selectFixedMissionQuestions(childId, grade, roundType, childContext);
  } catch (err) {
    console.warn("[start/route] selectFixedMissionQuestions failed, falling back:", err instanceof Error ? err.message : err);
  }

  if (questionIds.length >= 10) {
     isV2 = true; // Fixed 선택기 결과(PRIMARY 10개 + RESERVE 0~10개)
  } else {
    if (isAlphaQuestionChild) {
      questionIds = await selectAlphaQuestions(childId, grade, roundType, childContext);
      isV2 = true;
    } else if (isV2) {
      questionIds = await selectQuestionsV2(childId, grade, roundType, childContext);
    } else {
      questionIds = await selectQuestions(childId, grade, roundType, childContext);
    }
  }

  const REQUIRED_COUNT = isV2 ? 10 : 5;

  if (questionIds.length === 0) {
    return NextResponse.json({ error: "No eligible questions" }, { status: 409 });
  }

  // 미션 세션 생성 (session_type='mission')
  const { data: session, error: sessErr } = await service
    .from("chat_sessions")
    .insert({ child_id: childId, session_type: "mission" })
    .select("id")
    .single();

  if (sessErr || !session) {
    console.error("[start/route] Session insert failed:", sessErr);
    return NextResponse.json({ error: sessErr?.message ?? "Session insert failed" }, { status: 500 });
  }

  // 롤백 헬퍼 함수
  const rollbackSession = async (sessId: string) => {
    try {
      await service.from("chat_sessions").delete().eq("id", sessId);
    } catch (err) {
      console.error("[start/route] rollbackSession failed:", err);
    }
  };

  // mission_id 는 세션 id 로 지정 (미션=세션 1:1)
  const { error: updateSessErr } = await service
    .from("chat_sessions")
    .update({ mission_id: session.id })
    .eq("id", session.id);

  if (updateSessErr) {
    console.error("[start/route] chat_sessions update mission_id error:", updateSessErr);
    await rollbackSession(session.id);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // question_states 초기화 (전부 pending)
  const questionStates: Record<string, string> = {};
  for (const qid of questionIds) questionStates[qid] = "pending";

  const progressInsertPayload: any = {
    session_id: session.id,
    child_id: childId,
    business_date: businessDate,
    valid_answer_count: 0,
    question_ids: questionIds,
    question_states: questionStates,
    round_type: roundType,
  };

  if (isV2) {
    progressInsertPayload.required_valid_count = 10;
    progressInsertPayload.engine_version = "v2";
    progressInsertPayload.status = "IN_PROGRESS";
  }

  const { error: progErr } = await service.from("mission_progress").insert(progressInsertPayload);

  if (!progErr) {
    const { data: childData } = await service.from("child_profiles").select("family_id").eq("id", childId).single();
    
    let cMode = null;
    try {
      const { data: tm } = await service
        .from("test_mode_overrides")
        .select("conversation_mode")
        .eq("child_id", childId)
        .maybeSingle();
      if (tm) {
        cMode = tm.conversation_mode;
      }
    } catch (e) {
      cMode = null;
    }

    await logBehaviorEvent({
      eventName: "mission_start",
      actorType: "child",
      childId,
      familyId: childData?.family_id,
      sessionId: session.id,
      feature: "mission",
      conversationMode: cMode,
      route: "/api/mission/start",
    }).catch(() => {});
  }

  if (progErr) {
    console.error("[start/route] mission_progress insert error:", progErr);
    await rollbackSession(session.id);

    // 중복 INSERT (유니크 제약 위반) 시 기존 세션 재조회
    if (progErr.code === "23505" || progErr.message.includes("duplicate key") || progErr.message.includes("unique constraint")) {
      console.warn("[start/route] Duplicate session detected via unique constraint. Re-fetching existing session...");
      const { data: retrySessionRow } = await service
        .from("chat_sessions")
        .select("id, mission_progress!inner(status, valid_answer_count, question_ids, question_states, required_valid_count, engine_version)")
        .eq("child_id", childId)
        .eq("session_type", "mission")
        .gte("started_at", startOfDayKst)
        .lte("started_at", endOfDayKst)
        .eq("mission_progress.round_type", roundType)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (retrySessionRow) {
        const retrySessionId = retrySessionRow.id;
        const retryProgress = Array.isArray(retrySessionRow.mission_progress)
          ? retrySessionRow.mission_progress[0]
          : retrySessionRow.mission_progress;

        if (retryProgress?.status === "SAFETY_PAUSED") {
          return NextResponse.json(
            { error: "Mission is safety paused pending review", status: "SAFETY_PAUSED", sessionId: retrySessionId },
            { status: 423 }
          );
        }

        const isRetryV2 = retryProgress?.engine_version === "v2";
        const retryReqCount = isRetryV2 ? (retryProgress?.required_valid_count ?? 10) : 5;

        if (retryProgress) {
          const retryIds: string[] = retryProgress.question_ids ?? [];
          const { data: retryQuestions } = await service
            .from("mission_questions")
            .select("id, question_text, dashboard_area_tag, cycle_type, round_type")
            .in("id", retryIds);

          const orderedRetry = retryIds
            .map((qid) => (retryQuestions ?? []).find((q) => q.id === qid))
            .filter(Boolean);

          const retryPercent = (retryProgress.valid_answer_count ?? 0) * (isRetryV2 ? 10 : 20);
          const isRetryCompleted = retryProgress.status === "COMPLETED" || (retryProgress.valid_answer_count ?? 0) >= retryReqCount;

          return NextResponse.json({
            resumed: true,
            sessionId: retrySessionId,
            roundType,
            requiredCount: retryReqCount,
            progressPercent: retryPercent,
            completed: isRetryCompleted,
            engine_version: isRetryV2 ? "v2" : "v1",
            questionIds: retryIds,
            questions: orderedRetry,
            questionStates: retryProgress.question_states ?? {},
            validAnswerCount: retryProgress.valid_answer_count ?? 0,
            tier,
            voiceMode,
            liveVoiceName,
            givenName,
            childContext,
          });
        }
      }
    }

    return NextResponse.json({ error: progErr.message }, { status: 500 });
  }

  // 출제이력 기록
  if (isV2) {
    // V2: question_role (PRIMARY/RESERVE), selected_order 기록 (asked_at은 명시적으로 null 기록)
    const historyRows = questionIds.map((qid, idx) => ({
      child_id: childId,
      question_id: qid,
      question_role: idx < 10 ? ("PRIMARY" as const) : ("RESERVE" as const),
      selected_order: idx + 1,
      session_id: session.id,
    }));
    const { error: histErr } = await service.from("mission_question_history").insert(historyRows);
    if (histErr) {
      console.error("[start/route] mission_question_history V2 insert error:", histErr);
      await rollbackSession(session.id);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    // RESERVE가 목표(10개)에 못 미치면 즉시 보충을 시도한다.
    const reserveCount = historyRows.filter((r) => r.question_role === "RESERVE").length;
    if (reserveCount < RESERVE_TARGET_COUNT) {
      const shortfall = RESERVE_TARGET_COUNT - reserveCount;
      try {
        const backfillIds = await selectAdditionalReserveQuestions(childId, grade, roundType, questionIds, shortfall, childContext);
        if (backfillIds.length > 0) {
          const maxOrder = Math.max(...historyRows.map((r) => r.selected_order));
          const backfillRows = backfillIds.map((qid, i) => ({
            child_id: childId,
            question_id: qid,
            question_role: "RESERVE" as const,
            selected_order: maxOrder + 1 + i,
            session_id: session.id,
          }));
          const { error: backfillErr } = await service.from("mission_question_history").insert(backfillRows);
          if (backfillErr) {
            console.error("[start/route] RESERVE backfill insert error:", backfillErr);
          }
        }
        if (backfillIds.length < shortfall) {
          console.error("[start/route] MISSION_QUESTION_POOL_EXHAUSTED", {
            sessionId: session.id,
            childId,
            roundType,
            reserveCountAfterBackfill: reserveCount + backfillIds.length,
            targetReserveCount: RESERVE_TARGET_COUNT,
          });
        }
      } catch (e) {
        console.error("[start/route] RESERVE backfill failed:", e);
      }
    }
  } else {
    // V1: 기존 그대로 기록 (answer_status=NULL)
    const historyRows = questionIds.map((qid) => ({ child_id: childId, question_id: qid }));
    const { error: histErr } = await service.from("mission_question_history").insert(historyRows);
    if (histErr) {
      console.error("[start/route] mission_question_history V1 insert error:", histErr);
      await rollbackSession(session.id);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
  }

  // 선택된 질문 문항 반환
  const { data: questions, error: qListErr } = await service
    .from("mission_questions")
    .select("id, question_text, dashboard_area_tag, cycle_type, round_type")
    .in("id", questionIds);

  if (qListErr) {
    console.error("[start/route] mission_questions query error:", qListErr);
    await rollbackSession(session.id);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // questionIds 순서 유지
  const ordered = questionIds
    .map((qid) => (questions ?? []).find((q) => q.id === qid))
    .filter(Boolean);

  return NextResponse.json({
    resumed: false,
    sessionId: session.id,
    roundType,
    requiredCount: REQUIRED_COUNT,
    progressPercent: 0,
    completed: false,
    engine_version: isV2 ? "v2" : "v1",
    questionIds,
    questions: ordered,
    tier,
    voiceMode,
    liveVoiceName,
    givenName,
    childContext,
  });
}
