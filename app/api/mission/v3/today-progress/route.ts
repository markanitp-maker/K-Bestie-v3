import { NextRequest, NextResponse } from "next/server";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import {
  buildMissionEntrySnapshot,
  buildUnavailableSnapshot,
  buildV2Progress,
  buildV3Progress,
  type NormalizedMissionProgress,
  type RawSessionInput,
} from "@/lib/mission-v3/entryContract";
import {
  isV2ProgressRow,
  resolveMissionPolicyVersionForChild,
  type MissionProgressPolicyRow,
} from "@/lib/mission-v3/policyResolution";
import { buildGoalProgress, fetchMissionGoals } from "@/lib/mission-v3/routeSupport";
import { evaluateMissionTimeGate, type MissionTimeGateResult } from "@/lib/mission-v3/timePolicy";
import { currentRound, getKstHour } from "@/lib/mission/missionTimeGate";
import { isMissionScheduleEnforced } from "@/lib/mission/missionScheduleFlag";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface MissionProgressV2Row extends MissionProgressPolicyRow {
  status: string | null;
  valid_answer_count?: number | null;
  required_valid_count?: number | null;
  created_at?: string;
}

export async function GET(req: NextRequest) {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const childId = new URL(req.url).searchParams.get("childId")?.trim() ?? "";
  if (!UUID_PATTERN.test(childId)) {
    return NextResponse.json({ error: "childId required" }, { status: 400 });
  }

  const access = await requireChildAccess(authClient, user.id, childId);
  if (!access.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const service = createServiceClient();

  let resolvedPolicy: Awaited<ReturnType<typeof resolveMissionPolicyVersionForChild>>;
  try {
    resolvedPolicy = await resolveMissionPolicyVersionForChild({ db: service, childId, now });
  } catch (error) {
    console.error("[mission/v3/today-progress] same-day 정책 판정 실패", error);
    return NextResponse.json(
      buildUnavailableSnapshot({
        policyVersion: "v2_dual",
      }),
      { status: 500 },
    );
  }

  let timeGate: MissionTimeGateResult;
  try {
    timeGate = await evaluateMissionTimeGate({
      db: service,
      childId,
      now,
    });
  } catch (error) {
    console.error("[mission/v3/today-progress] 시간 게이트 판정 실패", error);
    return NextResponse.json(
      buildUnavailableSnapshot({
        policyVersion: resolvedPolicy.version,
        effectiveAt: resolvedPolicy.effectiveAt,
      }),
      { status: 500 },
    );
  }

  const businessDate = timeGate.businessDate;
  const enabled = (process.env.MISSION_TIME_GATE_ENABLED === "true") || timeGate.scheduleEnforced;

  const timeGateResponse = {
    enabled,
    allowedForNewStart: timeGate.allowed,
    scheduleEnforced: timeGate.scheduleEnforced,
    reason: timeGate.reason,
    allowed: timeGate.allowed,
    businessDate: timeGate.businessDate,
    currentMinute: timeGate.currentMinute,
    opensAtMinute: timeGate.opensAtMinute,
    closesAtMinute: timeGate.closesAtMinute,
    timeGateEnabled: timeGate.timeGateEnabled,
    displayKey: timeGate.displayKey,
  };

  // 1. 혼합 정책 (isMixed)인 경우 fail-closed 차단
  if (resolvedPolicy.isMixed || resolvedPolicy.blockedReason === "mixed_policy") {
    const snapshot = buildMissionEntrySnapshot({
      policyVersion: resolvedPolicy.version,
      effectiveAt: resolvedPolicy.effectiveAt,
      businessDate,
      isMixed: true,
      session: null,
      timeGate: timeGateResponse,
    });

    return NextResponse.json({
      ...snapshot,
      timeGate: timeGateResponse,
      hasMission: false,
      roundType: "common",
      operation: "blocked",
      canStart: false,
      goalProgress: null,
    });
  }

  // 2. v3_single_daily 정책인 경우
  if (resolvedPolicy.version === "v3_single_daily") {
    const { data: v3Progress, error: progressError } = await service
      .from("mission_progress")
      .select("session_id, status, business_date, round_type, mission_policy_version, effective_at")
      .eq("child_id", childId)
      .eq("business_date", businessDate)
      .eq("round_type", "daily_single")
      .maybeSingle();

    if (progressError) {
      console.error("[mission/v3/today-progress] v3 진행정보 조회 실패", progressError.message);
      return NextResponse.json(
        buildUnavailableSnapshot({
          businessDate,
          policyVersion: "v3_single_daily",
          effectiveAt: resolvedPolicy.effectiveAt,
          timeGate: timeGateResponse,
        }),
        { status: 500 },
      );
    }

    let goalProgress = null;
    let normalizedProgress: NormalizedMissionProgress | null = null;
    if (v3Progress?.session_id) {
      try {
        const goals = await fetchMissionGoals(service, v3Progress.session_id);
        goalProgress = buildGoalProgress(goals);
        normalizedProgress = buildV3Progress(goals);
      } catch (error) {
        console.error("[mission/v3/today-progress] Goal 진행 조회 실패", error);
        return NextResponse.json(
          buildUnavailableSnapshot({
            businessDate,
            policyVersion: "v3_single_daily",
            effectiveAt: resolvedPolicy.effectiveAt,
            timeGate: timeGateResponse,
          }),
          { status: 500 },
        );
      }
    }

    const sessionInput: RawSessionInput | null = v3Progress?.session_id
      ? {
          sessionId: v3Progress.session_id,
          status: v3Progress.status,
          progress: normalizedProgress,
        }
      : null;

    const snapshot = buildMissionEntrySnapshot({
      policyVersion: "v3_single_daily",
      effectiveAt: resolvedPolicy.effectiveAt,
      businessDate,
      session: sessionInput,
      timeGate: timeGateResponse,
    });

    return NextResponse.json({
      ...snapshot,
      timeGate: timeGateResponse,
      hasMission: Boolean(v3Progress),
      roundType: v3Progress?.round_type ?? "daily_single",
      operation:
        snapshot.entryState === "start"
          ? "create"
          : snapshot.entryState === "resume"
            ? "resume"
            : "blocked",
      canStart: snapshot.canEnter,
      goalProgress,
    });
  }

  // 3. v2_dual 정책인 경우: 기존 v2 라우트(app/api/mission/today-progress/route.ts)와 동일한 기준 적용
  const startOfDayKst = new Date(`${businessDate}T00:00:00+09:00`).toISOString();
  const endOfDayKst = new Date(`${businessDate}T23:59:59.999+09:00`).toISOString();
  const scheduleEnforced = isMissionScheduleEnforced();
  const activeRound = currentRound(getKstHour(), scheduleEnforced);
  const roundNow = activeRound ?? "common";

  const { data: sessionRow, error: sessionErr } = await service
    .from("chat_sessions")
    .select("id, started_at, mission_progress!inner(session_id, status, valid_answer_count, required_valid_count, round_type, mission_policy_version, effective_at)")
    .eq("child_id", childId)
    .eq("session_type", "mission")
    .eq("mission_progress.round_type", roundNow)
    .gte("started_at", startOfDayKst)
    .lte("started_at", endOfDayKst)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sessionErr) {
    console.error("[mission/v3/today-progress] v2 세션 조회 실패", sessionErr.message);
    return NextResponse.json(
      buildUnavailableSnapshot({
        businessDate,
        policyVersion: "v2_dual",
        effectiveAt: resolvedPolicy.effectiveAt,
        timeGate: timeGateResponse,
      }),
      { status: 500 },
    );
  }

  const progress = sessionRow
    ? (Array.isArray(sessionRow.mission_progress)
        ? sessionRow.mission_progress[0]
        : sessionRow.mission_progress)
    : null;

  let sessionInput: RawSessionInput | null = null;
  if (sessionRow && progress) {
    sessionInput = {
      sessionId: sessionRow.id,
      status: progress.status,
      progress: buildV2Progress(progress.valid_answer_count, progress.required_valid_count),
    };
  }

  const snapshot = buildMissionEntrySnapshot({
    policyVersion: "v2_dual",
    effectiveAt: resolvedPolicy.effectiveAt,
    businessDate,
    session: sessionInput,
    timeGate: timeGateResponse,
  });

  return NextResponse.json({
    ...snapshot,
    timeGate: timeGateResponse,
    hasMission: Boolean(sessionRow),
    roundType: progress?.round_type ?? roundNow,
    operation:
      snapshot.entryState === "start"
        ? "create"
        : snapshot.entryState === "resume"
          ? "resume"
          : "blocked",
    canStart: snapshot.canEnter,
    goalProgress: null,
  });
}

