import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { selectQuestions, selectQuestionsV2, parseGrade, countApprovedV2Candidates, REQUIRED_COUNT_V2, TOTAL_COUNT_V2, type RoundType } from "@/lib/mission/selectQuestions";
import { getVoiceModeForChild } from "@/lib/plan/voiceMode";
import { checkConsentForChild } from "@/lib/plan/consentGuard";
import { checkApprovalForChild } from "@/lib/plan/approvalGuard";
import { isQuestionEngineV2Enabled } from "@/lib/questions/feature-flags";
import { isChildAlphaAllowedForQuestions } from "@/lib/questions/alphaAllowlist";
import { selectAlphaQuestions, selectFixedMissionQuestions, selectAdditionalReserveQuestions, RESERVE_TARGET_COUNT } from "@/lib/mission/selectQuestions";
import { ChildConversationContext } from "@/lib/mission/ChildConversationContext";
import { buildMemoryGreeting } from "@/lib/mission/memoryGreeting";
import { appendVocative } from "@/lib/utils/koreanParticle";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";
import { getKstHour, currentRound } from "@/lib/mission/missionTimeGate";
import { isMissionScheduleEnforced } from "@/lib/mission/missionScheduleFlag";
import { getMissionPhase, assertMissionSessionActive } from "@/app/api/_lib/missionUtils";

export const runtime = "nodejs";

// Historical v2 round start endpoint. Mission v3 clients use /api/mission/v3/start.

const VALID_ROUNDS: RoundType[] = ["round1_day", "round2_night", "common"];

export async function POST(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { childId?: string; roundType?: RoundType; checkOnly?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { childId, roundType, checkOnly } = body;
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

  // Production 시간 게이트는 기존 세션 조회 뒤, 신규 생성 경로에만 적용한다.
  // 이미 오늘 시작한 세션은 운영 시작 전이나 신규 시작 마감 뒤에도 이어할 수 있어야 한다.
  const scheduleEnforced = isMissionScheduleEnforced();

  const consentBlocked = await checkConsentForChild(childId);
  if (consentBlocked) return consentBlocked;

  const approvalBlocked = await checkApprovalForChild(childId);
  if (approvalBlocked) return approvalBlocked;

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

  // ── 하루 1미션 compatibility guard: KST 기준 오늘(business_date) 생성된 미션을
  // round_type과 무관하게 모두 조회한다. quota의 기준은 child_id + business_date이며,
  // round_type은 질문/레거시 리포트 호환용 metadata일 뿐 오늘 몇 번째 미션인지 판단하지 않는다.
  //
  // 주의(2026-07-25 확인): chat_sessions.ended_at은 미션 완료 시 이 코드베이스 어디에서도 갱신되지
  // 않는다(완료 처리는 mission_progress.status='COMPLETED'만 찍고 chat_sessions는 건드리지 않음 —
  // grep으로 전체 저장소 확인 완료, 유일하게 ended_at을 쓰는 곳은 test-mission 전용 라우트와
  // free 세션 배치뿐). 그래서 과거 "ended_at IS NULL = 활성"이라는 전제 자체가 항상 참이 돼(완료된
  // 미션 세션도 ended_at이 계속 NULL로 남아 있으므로) 완료 세션이 매번 "활성 세션"으로 오인되어
  // 재사용됐다 — 011의 "완료 후 재시작해도 이전 완료 세션을 이어한다" 버그의 실제 원인.
  // ended_at 대신 mission_progress.status로 직접 판정한다. COMPLETED는 오늘 quota를 소비해
  // 신규 생성을 잠그고, 그 외(IN_PROGRESS/SAFETY_PAUSED/V1의 null 등)는 기존 세션을 대상으로
  // 후속 상태 검사를 수행한다.
  const { data: todaySessionRows, error: todaySessionErr } = await service
    .from("chat_sessions")
    .select("id, started_at, mission_progress!inner(status, valid_answer_count, question_ids, question_states, required_valid_count, engine_version, round_type)")
    .eq("child_id", childId)
    .eq("session_type", "mission")
    .eq("mission_progress.business_date", businessDate)
    .gte("started_at", startOfDayKst)
    .lte("started_at", endOfDayKst)
    .order("started_at", { ascending: false })
    .order("id", { ascending: false });

  if (todaySessionErr) {
    console.error("[start/route] todaySession query error:", todaySessionErr);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const completedSessionRow = (todaySessionRows ?? []).find((row) => {
    const progress = Array.isArray(row.mission_progress) ? row.mission_progress[0] : row.mission_progress;
    return progress?.status === "COMPLETED";
  });
  if (completedSessionRow) {
    // 하루 1미션 정책에서는 완료가 child_id + business_date quota를 소비한다.
    // 응답 roundType은 레거시 프론트 계약을 위해 요청값을 유지한다.
    return NextResponse.json({
      locked: true,
      alreadyCompletedToday: true,
      roundType,
    });
  }

  // 레거시 중복 row가 있으면 started_at 최신순의 첫 미완료 세션 하나만 결정론적으로 재개한다.
  // 데이터는 삭제·수정하지 않는다.
  const existingSessionRow = (todaySessionRows ?? []).find((row) => {
    const progress = Array.isArray(row.mission_progress) ? row.mission_progress[0] : row.mission_progress;
    return progress?.status !== "COMPLETED";
  }) ?? null;

  if (existingSessionRow) {
    const existingSessionId = existingSessionRow.id;
    const sessionCheck = await assertMissionSessionActive(service, existingSessionId);
    if (!sessionCheck.allowed) {
      return NextResponse.json(
        { error: sessionCheck.error, code: sessionCheck.code, status: sessionCheck.status, scheduleClosed: true, expired: sessionCheck.expired },
        { status: sessionCheck.expired ? 403 : 423 }
      );
    }

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

      // 037 §5·§12·§13/codex 지적: 복원할 질문이 실제로 존재하지 않으면(삭제된 문항 등) 빈
      // 질문 목록으로 이어하기를 성공 처리하지 말고 복원 실패로 보고한다 - 세션은 삭제하지 않는다.
      if (existingIds.length > 0 && orderedExisting.length === 0) {
        console.error("[start/route] Resume restore failed: no matching questions found for existing session", { existingSessionId, existingIds });
        return NextResponse.json({ error: "진행 중인 미션을 불러오지 못했어요", sessionId: existingSessionId }, { status: 500 });
      }

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

  // 신규 세션이 필요한 경우에만 Production 단일 운영창(09:00 inclusive ~ 23:50
  // exclusive)과 canonical compatibility round를 검증한다. Dev에서는 24시간 허용한다.
  let missionRoundType = roundType;
  if (scheduleEnforced) {
    const actualRound = currentRound(getKstHour(), true);
    if (!actualRound) {
      return NextResponse.json({ error: "미션 시간이 아닙니다.", scheduleClosed: true }, { status: 403 });
    }
    // cached v2 clients may still request round1_day/common. Inside the single window the
    // server normalizes every new session to the canonical midnight-compatible round.
    missionRoundType = actualRound;
  }

  if (checkOnly) {
    return NextResponse.json({ resumed: false, checkOnly: true, tier, voiceMode, liveVoiceName, givenName });
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
    const eligibleCount = await countApprovedV2Candidates(childId, grade, missionRoundType, childContext);
    if (eligibleCount < REQUIRED_COUNT_V2 || eligibleCount < TOTAL_COUNT_V2) {
      console.warn("[start/route] V2->V1 폴백: 개인화 적용 후 가용 문항 부족", {
        childId,
        grade,
        roundType: missionRoundType,
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
    questionIds = await selectFixedMissionQuestions(childId, grade, missionRoundType, childContext);
  } catch (err) {
    console.warn("[start/route] selectFixedMissionQuestions failed, falling back:", err instanceof Error ? err.message : err);
  }

  if (questionIds.length >= 10) {
     isV2 = true; // Fixed 선택기 결과(PRIMARY 10개 + RESERVE 0~10개)
  } else {
    if (isAlphaQuestionChild) {
      questionIds = await selectAlphaQuestions(childId, grade, missionRoundType, childContext);
      isV2 = true;
    } else if (isV2) {
      questionIds = await selectQuestionsV2(childId, grade, missionRoundType, childContext);
    } else {
      questionIds = await selectQuestions(childId, grade, missionRoundType, childContext);
    }
  }

  const REQUIRED_COUNT = isV2 ? 10 : 5;

  if (questionIds.length === 0) {
    return NextResponse.json({ error: "No eligible questions" }, { status: 409 });
  }

  // 022 Phase 2A: 미션 시작 시 서버가 KST 유효 시간과 실제 미션 종류를 검증하여 mission_phase(1 또는 2)를 확정 저장한다.
  const mission_phase = getMissionPhase(missionRoundType, false, scheduleEnforced);
  if (mission_phase === null) {
    return NextResponse.json({ error: "현재 미션을 시작할 수 있는 시간이 아닙니다.", scheduleClosed: true }, { status: 403 });
  }

  // 미션 세션 생성 (session_type='mission')
  const { data: session, error: sessErr } = await service
    .from("chat_sessions")
    .insert({ child_id: childId, session_type: "mission", mission_phase })
    .select("id")
    .single();

  if (sessErr || !session) {
    console.error("[start/route] Session insert failed:", sessErr);
    return NextResponse.json({ error: sessErr?.message ?? "Session insert failed" }, { status: 500 });
  }

  // 롤백 헬퍼 함수
  const rollbackSession = async (sessId: string) => {
    try {
      const { error: progressDeleteErr } = await service
        .from("mission_progress")
        .delete()
        .eq("session_id", sessId);

      if (progressDeleteErr) {
        console.error("[start/route] rollbackSession mission_progress delete failed; database consistency may be compromised:", {
          sessionId: sessId,
          error: progressDeleteErr,
        });
        return;
      }

      const { error: sessionDeleteErr } = await service
        .from("chat_sessions")
        .delete()
        .eq("id", sessId);

      if (sessionDeleteErr) {
        console.error("[start/route] rollbackSession chat_sessions delete failed; database consistency may be compromised:", {
          sessionId: sessId,
          error: sessionDeleteErr,
        });
      }
    } catch (err) {
      console.error("[start/route] rollbackSession threw; database consistency may be compromised:", {
        sessionId: sessId,
        error: err,
      });
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
    round_type: missionRoundType,
  };

  if (isV2) {
    progressInsertPayload.required_valid_count = 10;
    progressInsertPayload.engine_version = "v2";
    progressInsertPayload.status = "IN_PROGRESS";
  }

  const { error: progErr } = await service.from("mission_progress").insert(progressInsertPayload);

  if (!progErr) {
    // 037 §9: 시작하기 버튼 중복 클릭으로 인한 세션 다중 생성 방지 (Post-verification)
    // codex 리뷰 지적: PostgREST의 .neq()는 SQL NULL 3치 논리상 status IS NULL인 행(레거시 V1)을
    // 결과에서 아예 제외한다 - DB 필터 대신 JS에서 직접 비교해(위 todaySessionRow 조회와 동일한
    // "!== COMPLETED"를 null-안전하게 적용하는 기존 관례) V1 세션도 활성 후보에 포함시킨다.
    const { data: postInsertSessionsRaw, error: postInsertSessionsErr } = await service
      .from("chat_sessions")
      .select("id, started_at, mission_progress!inner(status, valid_answer_count, question_ids, question_states, required_valid_count, engine_version, round_type)")
      .eq("child_id", childId)
      .eq("session_type", "mission")
      .eq("mission_progress.business_date", businessDate)
      .gte("started_at", startOfDayKst)
      .lte("started_at", endOfDayKst)
      .order("started_at", { ascending: true })
      .order("id", { ascending: true }); // 동시 생성 시 모든 요청이 같은 winner를 고른다.

    if (postInsertSessionsErr) {
      console.error("[start/route] post-insert quota verification error:", postInsertSessionsErr);
      await rollbackSession(session.id);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    const postInsertCompleted = (postInsertSessionsRaw ?? []).find((row) => {
      const p = Array.isArray(row.mission_progress) ? row.mission_progress[0] : row.mission_progress;
      return p?.status === "COMPLETED";
    });

    if (postInsertCompleted && postInsertCompleted.id !== session.id) {
      console.warn("[start/route] Completed daily quota detected after insert. Rolling back the new session.");
      await rollbackSession(session.id);
      return NextResponse.json({
        locked: true,
        alreadyCompletedToday: true,
        roundType,
      });
    }

    const activeSessions = (postInsertSessionsRaw ?? []).filter((row) => {
      const p = Array.isArray(row.mission_progress) ? row.mission_progress[0] : row.mission_progress;
      return p?.status !== "COMPLETED";
    });

    // round_type이 다른 동시 요청도 child/date 단위로 같은 가장 이른 winner를 선택한다.
    if (activeSessions.length > 1 && activeSessions[0].id !== session.id) {
      console.warn("[start/route] Daily quota concurrency detected. Rolling back the newly created session and reusing the winner.");
      await rollbackSession(session.id);
      
      const retrySessionRow = activeSessions[0];
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

      const retryIds: string[] = retryProgress?.question_ids ?? [];
      const { data: retryQuestions } = await service
        .from("mission_questions")
        .select("id, question_text, dashboard_area_tag, cycle_type, round_type")
        .in("id", retryIds);

      const orderedRetry = retryIds
        .map((qid) => (retryQuestions ?? []).find((q) => q.id === qid))
        .filter(Boolean);

      const retryPercent = (retryProgress?.valid_answer_count ?? 0) * (isRetryV2 ? 10 : 20);
      const isRetryCompleted = retryProgress?.status === "COMPLETED" || (retryProgress?.valid_answer_count ?? 0) >= retryReqCount;

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
        questionStates: retryProgress?.question_states ?? {},
        validAnswerCount: retryProgress?.valid_answer_count ?? 0,
        tier,
        voiceMode,
        liveVoiceName,
        givenName,
        childContext,
      });
    }

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
      const { data: retrySessionRows, error: retrySessionErr } = await service
        .from("chat_sessions")
        .select("id, started_at, mission_progress!inner(status, valid_answer_count, question_ids, question_states, required_valid_count, engine_version, round_type)")
        .eq("child_id", childId)
        .eq("session_type", "mission")
        .eq("mission_progress.business_date", businessDate)
        .gte("started_at", startOfDayKst)
        .lte("started_at", endOfDayKst)
        .order("started_at", { ascending: false })
        .order("id", { ascending: false });

      if (retrySessionErr) {
        console.error("[start/route] duplicate retry query error:", retrySessionErr);
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }

      const retryCompletedRow = (retrySessionRows ?? []).find((row) => {
        const progress = Array.isArray(row.mission_progress) ? row.mission_progress[0] : row.mission_progress;
        return progress?.status === "COMPLETED";
      });
      if (retryCompletedRow) {
        return NextResponse.json({
          locked: true,
          alreadyCompletedToday: true,
          roundType,
        });
      }

      const retrySessionRow = (retrySessionRows ?? []).find((row) => {
        const progress = Array.isArray(row.mission_progress) ? row.mission_progress[0] : row.mission_progress;
        return progress?.status !== "COMPLETED";
      });

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
        const backfillIds = await selectAdditionalReserveQuestions(childId, grade, missionRoundType, questionIds, shortfall, childContext);
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
            roundType: missionRoundType,
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

  // requests/011 A안(2026-07-26 확정): 새 세션(비-이어하기) 인사말에 한해 최근 기억을
  // 조회해 연결성이 높을 때만 개인화된 인사말을 시도한다. 실패/무관련이면 null을 반환해
  // 클라이언트(app/child/missions/page.tsx)의 기존 템플릿 인사말로 자연스럽게 폴백된다.
  const memoryGreeting = await buildMemoryGreeting(
    service,
    childId,
    givenName ? appendVocative(givenName) : null
  );

  return NextResponse.json({
    resumed: false,
    sessionId: session.id,
    roundType: missionRoundType,
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
    memoryGreeting,
  });
}
