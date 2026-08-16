import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import {
  initializeConversationGoals,
  type ConversationGoal,
} from "@/lib/mission-v3/goalEngine";
import { resolveMissionPolicyVersionForChild } from "@/lib/mission-v3/policyResolution";
import { loadMissionQuestionGoalCandidates } from "@/lib/mission-v3/questionBank";
import {
  buildGoalProgress,
  fetchMissionGoals,
  fetchResumableMissionTurn,
  getMissionWeekday,
} from "@/lib/mission-v3/routeSupport";
import { decideDailySingleOperation } from "@/lib/mission-v3/timePolicy";
import { getEffectiveContentGrade, parseGrade } from "@/lib/mission/selectQuestions";
import { checkApprovalForChild } from "@/lib/plan/approvalGuard";
import { checkConsentForChild } from "@/lib/plan/consentGuard";
import { getVoiceModeForChild } from "@/lib/plan/voiceMode";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface StartBody {
  childId?: string;
}
interface ChildProfileRow {
  id: string;
  name: string;
  given_name: string | null;
  grade: string | number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const rollbackCreatedSession = async (
  service: ReturnType<typeof createServiceClient>,
  sessionId: string,
): Promise<void> => {
  const { error: progressError } = await service
    .from("mission_progress")
    .delete()
    .eq("session_id", sessionId);
  if (progressError) {
    console.error("[mission/v3/start] 신규 진행정보 롤백 실패", progressError.message);
  }
  const { error: sessionError } = await service
    .from("chat_sessions")
    .delete()
    .eq("id", sessionId);
  if (sessionError) {
    console.error("[mission/v3/start] 신규 세션 롤백 실패", sessionError.message);
  }
};

const ensureGoals = async (input: {
  service: ReturnType<typeof createServiceClient>;
  sessionId: string;
  childId: string;
  contentGrade: number;
  now: Date;
}): Promise<ConversationGoal[]> => {
  const existingGoals = await fetchMissionGoals(input.service, input.sessionId);
  if (existingGoals.length === 4) return existingGoals;

  const candidates = await loadMissionQuestionGoalCandidates({
    db: input.service,
    childId: input.childId,
    grade: input.contentGrade,
    weekday: getMissionWeekday(input.now),
  });
  return initializeConversationGoals({
    db: input.service,
    missionSessionId: input.sessionId,
    childId: input.childId,
    sessionKind: "daily_single",
    candidates,
  });
};

export async function POST(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: StartBody;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    body = parsed as StartBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const childId = typeof body.childId === "string" ? body.childId.trim() : "";
  if (!UUID_PATTERN.test(childId)) {
    return NextResponse.json({ error: "childId required" }, { status: 400 });
  }

  const access = await requireChildAccess(authClient, user.id, childId);
  if (!access.allowed || access.role !== "child") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const consentBlocked = await checkConsentForChild(childId);
  if (consentBlocked) return consentBlocked;
  const approvalBlocked = await checkApprovalForChild(childId);
  if (approvalBlocked) return approvalBlocked;

  const service = createServiceClient();
  const { data: childProfile, error: childError } = await service
    .from("child_profiles")
    .select("id, name, given_name, grade")
    .eq("id", childId)
    .maybeSingle();
  if (childError) {
    console.error("[mission/v3/start] 아이 프로필 조회 실패", childError.message);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
  if (!childProfile) {
    return NextResponse.json({ error: "Child not found" }, { status: 404 });
  }

  const profile = childProfile as ChildProfileRow;
  const realGrade = parseGrade(profile.grade);
  if (realGrade === null || realGrade < 1 || realGrade > 7) {
    return NextResponse.json({ error: "Cannot parse child grade" }, { status: 400 });
  }
  const contentGrade = getEffectiveContentGrade(realGrade);
  const now = new Date();
  let resolvedPolicy: Awaited<ReturnType<typeof resolveMissionPolicyVersionForChild>>;
  try {
    resolvedPolicy = await resolveMissionPolicyVersionForChild({ db: service, childId, now });
  } catch (error) {
    console.error("[mission/v3/start] same-day 정책 판정 실패", error);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
  const policy = {
    missionPolicyVersion: resolvedPolicy.version,
    effectiveAt: resolvedPolicy.effectiveAt,
  };

  let operation: Awaited<ReturnType<typeof decideDailySingleOperation>>;
  try {
    operation = await decideDailySingleOperation({
      db: service,
      childId,
      policy,
      now,
    });
  } catch (error) {
    console.error("[mission/v3/start] daily_single 정책 판정 실패", error);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }

  if (operation.action === "blocked") {
    const status = operation.existingSessionId
      ? await service
          .from("mission_progress")
          .select("status")
          .eq("session_id", operation.existingSessionId)
          .maybeSingle()
      : null;
    return NextResponse.json({
      error: operation.reason === "daily_limit_reached"
        ? "오늘 미션은 이미 마쳤어요."
        : operation.reason === "before_open"
          ? "아직 미션 시간이 아니에요."
          : operation.reason === "closed"
            ? "오늘 미션 시간이 끝났어요."
            : "Mission v3 정책이 아직 활성화되지 않았어요.",
      reason: operation.reason,
      policyVersion: resolvedPolicy.version,
      effectiveAt: resolvedPolicy.effectiveAt,
      businessDate: operation.businessDate,
      sessionId: operation.existingSessionId,
      status: status?.data?.status ?? null,
    }, { status: operation.reason === "daily_limit_reached" ? 409 : 403 });
  }

  let sessionId = operation.action === "resume" ? operation.sessionId : randomUUID();
  let resumed = operation.action === "resume";
  if (operation.action === "create") {
    const { error: sessionError } = await service.from("chat_sessions").insert({
      id: sessionId,
      child_id: childId,
      session_type: "mission",
      mission_id: sessionId,
      // daily_single은 하루 마감 수집(기존 phase 2)에 한 번만 포함한다.
      mission_phase: 2,
      business_date: operation.businessDate,
    });
    if (sessionError) {
      console.error("[mission/v3/start] 세션 생성 실패", sessionError.message);
      return NextResponse.json({ error: "세션을 시작하지 못했어요." }, { status: 500 });
    }

    const { error: progressError } = await service.from("mission_progress").insert({
      session_id: sessionId,
      child_id: childId,
      business_date: operation.businessDate,
      status: "IN_PROGRESS",
      valid_answer_count: 0,
      required_valid_count: 3,
      question_ids: [],
      question_states: {},
      round_type: "daily_single",
      engine_version: "v3",
      mission_policy_version: operation.missionPolicyVersion,
      effective_at: operation.effectiveAt,
    });

    if (progressError) {
      await rollbackCreatedSession(service, sessionId);
      const isDuplicate = progressError.code === "23505"
        || progressError.message.includes("duplicate key")
        || progressError.message.includes("unique constraint");
      if (!isDuplicate) {
        console.error("[mission/v3/start] 진행정보 생성 실패", progressError.message);
        return NextResponse.json({ error: "미션 진행정보를 만들지 못했어요." }, { status: 500 });
      }

      const { data: existing, error: existingError } = await service
        .from("mission_progress")
        .select("session_id, status")
        .eq("child_id", childId)
        .eq("business_date", operation.businessDate)
        .eq("round_type", "daily_single")
        .maybeSingle();
      if (existingError
        || !existing
        || existing.status === "COMPLETED"
        || existing.status === "SAFETY_PAUSED"
        || existing.status === "FORCE_ENDED") {
        return NextResponse.json({
          error: "오늘 미션은 이미 시작되었어요.",
          reason: "daily_limit_reached",
          policyVersion: resolvedPolicy.version,
          effectiveAt: resolvedPolicy.effectiveAt,
          businessDate: operation.businessDate,
          sessionId: existing?.session_id,
          status: existing?.status ?? null,
        }, { status: 409 });
      }
      sessionId = existing.session_id;
      resumed = true;
    }
  }

  let goals: ConversationGoal[];
  try {
    goals = await ensureGoals({ service, sessionId, childId, contentGrade, now });
  } catch (error) {
    console.error("[mission/v3/start] Conversation Goal 초기화 실패", error);
    if (!resumed) await rollbackCreatedSession(service, sessionId);
    return NextResponse.json({ error: "미션 대화를 준비하지 못했어요." }, { status: 500 });
  }

  const { data: progress, error: progressError } = await service
    .from("mission_progress")
    .select("status, business_date, mission_policy_version, effective_at")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (progressError || !progress || progress.mission_policy_version !== "v3_single_daily") {
    console.error("[mission/v3/start] 세션 정책 스냅샷 확인 실패", progressError?.message);
    if (!resumed) await rollbackCreatedSession(service, sessionId);
    return NextResponse.json({ error: "미션 정책을 확인하지 못했어요." }, { status: 500 });
  }

  const { tier, voiceMode, liveVoiceName } = await getVoiceModeForChild(childId);
  // 이전 요청이 실패해 아이 발화만 남은 턴이 있으면 그대로 알려준다. 클라이언트가
  // 브라우저 메모리에 기대지 않고 언제 다시 들어와도 같은 턴을 이어서 보낼 수 있다.
  const pendingTurn = await fetchResumableMissionTurn(service, sessionId);
  return NextResponse.json({
    pendingTurn,
    resumed,
    sessionId,
    policyVersion: progress.mission_policy_version,
    effectiveAt: progress.effective_at,
    businessDate: progress.business_date,
    status: progress.status,
    completed: progress.status === "COMPLETED",
    goalProgress: buildGoalProgress(goals),
    tier,
    voiceMode,
    liveVoiceName,
    givenName: profile.given_name,
    childContext: {
      childId,
      displayName: profile.name,
      givenName: profile.given_name,
      grade: realGrade,
      knownProfileFacts: {},
    },
  });
}
