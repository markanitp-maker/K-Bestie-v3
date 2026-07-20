import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { selectQuestions, selectQuestionsV2, parseGrade, countApprovedV2Candidates, REQUIRED_COUNT_V2, TOTAL_COUNT_V2, type RoundType } from "@/lib/mission/selectQuestions";
import { getVoiceModeForChild } from "@/lib/plan/voiceMode";
import { checkConsentForChild } from "@/lib/plan/consentGuard";
import { isQuestionEngineV2Enabled } from "@/lib/questions/feature-flags";
import { isChildAlphaAllowedForQuestions } from "@/lib/questions/alphaAllowlist";
import { selectAlphaQuestions } from "@/lib/mission/selectQuestions";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";

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

  // 요금제(tier)별 음성 방식 — 미션 로직(정답판정/게이지/황금열쇠/라운드)과 무관한 부가 정보
  const { tier, voiceMode, liveVoiceName } = await getVoiceModeForChild(childId);

  // ── 이어하기: 아직 끝나지 않은(ended_at IS NULL) 같은 라운드의 미션 세션이 있으면 이어서 반환
  const { data: existingSession, error: existingSessionErr } = await service
    .from("chat_sessions")
    .select("id")
    .eq("child_id", childId)
    .eq("session_type", "mission")
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingSessionErr) {
    console.error("[start/route] existingSession query error:", existingSessionErr);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (existingSession) {
    // 1) status만 먼저 단독 조회 — isV2(라이브 플래그)와 무관하게 항상 실행
    const { data: statusRow, error: statusErr } = await service
      .from("mission_progress")
      .select("status")
      .eq("session_id", existingSession.id)
      .eq("round_type", roundType)
      .maybeSingle();

    if (statusErr) {
      console.error("[start/route] status query error:", statusErr);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    if (statusRow?.status === "SAFETY_PAUSED") {
      return NextResponse.json(
        { error: "Mission is safety paused pending review", status: "SAFETY_PAUSED", sessionId: existingSession.id },
        { status: 423 }
      );
    }

    interface ExistingProgressRow {
      session_id: string;
      valid_answer_count: number | null;
      question_ids: string[] | null;
      question_states: Record<string, string> | null;
      round_type: string | null;
      required_valid_count?: number | null;
      engine_version?: string | null;
    }

    // 2) 나머지 필드 조회 — required_valid_count, engine_version 상시 포함
    const fields = "session_id, valid_answer_count, question_ids, question_states, round_type, required_valid_count, engine_version";

    const { data: existingProgress, error: existingProgressErr } = (await service
      .from("mission_progress")
      .select(fields)
      .eq("session_id", existingSession.id)
      .eq("round_type", roundType)
      .maybeSingle()) as unknown as { data: ExistingProgressRow | null; error: { message: string } | null };

    if (existingProgressErr) {
      console.error("[start/route] existingProgress query error:", existingProgressErr);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    const isExistingV2 = existingProgress?.engine_version === "v2";
    const reqCount = isExistingV2 ? (existingProgress?.required_valid_count ?? 10) : 5;

    // COMPLETED 체크는 이제 statusRow 기준(플래그와 무관하게 항상 신뢰 가능)
    if (existingProgress && (existingProgress.valid_answer_count ?? 0) < reqCount && statusRow?.status !== "COMPLETED") {
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

      return NextResponse.json({
        resumed: true,
        sessionId: existingSession.id,
        roundType,
        requiredCount: reqCount,
        progressPercent,
        completed: (existingProgress.valid_answer_count ?? 0) >= reqCount,
        engine_version: isExistingV2 ? "v2" : "v1",
        questionIds: existingIds,
        questions: orderedExisting,
        questionStates: existingProgress.question_states ?? {},
        validAnswerCount: existingProgress.valid_answer_count ?? 0,
        tier,
        voiceMode,
        liveVoiceName,
      });
    }
  }

  // 아이 학년 조회
  const { data: child, error: childErr } = await service
    .from("child_profiles")
    .select("id, grade")
    .eq("id", childId)
    .single();

  if (childErr || !child) {
    return NextResponse.json({ error: "Child not found" }, { status: 404 });
  }

  const grade = parseGrade(child.grade);
  if (grade === null) {
    return NextResponse.json({ error: "Cannot parse child grade" }, { status: 400 });
  }

  // 개인화(쿨다운·최근출제) 적용 후 실제 가용 문항이 PRIMARY 10개 + 전체 20개 미만이면 V1 폴백.
  // 미승인·중복(쿨다운 미충족) 문항을 억지로 채워 넣지 않는다 — selectQuestionsV2가 내부적으로
  // 후보 부족 시 쿨다운 미충족 문항까지 강제로 채우는 보정 로직을 갖고 있으므로, 그 보정에 기대지 않고
  // 이 게이트에서 미리 차단한다.
  if (isV2 && !isAlphaQuestionChild) {
    const eligibleCount = await countApprovedV2Candidates(childId, grade, roundType);
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

  const REQUIRED_COUNT = (isV2 || isAlphaQuestionChild) ? 10 : 5;

  // 출제 질문 선별
  let questionIds: string[] = [];
  if (isAlphaQuestionChild) {
    questionIds = await selectAlphaQuestions(childId, grade, roundType);
    isV2 = true;
  } else if (isV2) {
    questionIds = await selectQuestionsV2(childId, grade, roundType);
  } else {
    questionIds = await selectQuestions(childId, grade, roundType);
  }

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

  if (progErr) {
    console.error("[start/route] mission_progress insert error:", progErr);
    await rollbackSession(session.id);
    return NextResponse.json({ error: progErr.message }, { status: 500 });
  }

  // 출제이력 기록
  if (isV2) {
    // V2: question_role (PRIMARY/RESERVE), selected_order 기록 (asked_at은 명시적으로 null 기록)
    const historyRows = questionIds.map((qid, idx) => ({
      child_id: childId,
      question_id: qid,
      question_role: idx < 10 ? "PRIMARY" : "RESERVE",
      selected_order: idx + 1,
      session_id: session.id,
    }));
    const { error: histErr } = await service.from("mission_question_history").insert(historyRows);
    if (histErr) {
      console.error("[start/route] mission_question_history V2 insert error:", histErr);
      await rollbackSession(session.id);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
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
  });
}
