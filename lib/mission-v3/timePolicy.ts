import type { SupabaseClient } from "@supabase/supabase-js";

import { currentRound } from "@/lib/mission/missionTimeGate";
import { isMissionScheduleEnforced } from "@/lib/mission/missionScheduleFlag";

export type MissionPolicyVersion = "v2_dual" | "v3_single_daily";
export type DailySingleBlockReason =
  | "policy_not_effective"
  | "before_open"
  | "closed"
  | "daily_limit_reached";

export type MissionTimeGateDisplayKey =
  | "before_open"
  | "between_rounds"
  | "closed"
  | null;

export interface MissionPolicySnapshot {
  missionPolicyVersion: MissionPolicyVersion;
  effectiveAt: string | null;
}

export interface MissionTimeGateResult {
  allowed: boolean;
  businessDate: string;
  currentMinute: number;
  opensAtMinute: number;
  closesAtMinute: number;
  scheduleEnforced: boolean;
  timeGateEnabled: boolean;
  reason: "before_open" | "closed" | null;
  displayKey: MissionTimeGateDisplayKey;
}

interface DailySingleProgressRow {
  session_id: string;
  status: string | null;
  mission_policy_version: MissionPolicyVersion;
  effective_at: string | null;
}

export type DailySingleOperationDecision =
  | {
      action: "create";
      businessDate: string;
      missionPolicyVersion: "v3_single_daily";
      effectiveAt: string;
      gate: MissionTimeGateResult;
    }
  | {
      action: "resume";
      sessionId: string;
      businessDate: string;
    }
  | {
      action: "blocked";
      reason: DailySingleBlockReason;
      businessDate: string;
      existingSessionId?: string;
      gate?: MissionTimeGateResult;
    };

export function isMissionTimeGateEnabled(): boolean {
  return process.env.MISSION_TIME_GATE_ENABLED === "true";
}

export interface MissionTimePolicyDependencies {
  isMissionScheduleEnforced: typeof isMissionScheduleEnforced;
  isMissionTimeGateEnabled: typeof isMissionTimeGateEnabled;
}

const DEFAULT_DEPENDENCIES: MissionTimePolicyDependencies = {
  isMissionScheduleEnforced,
  isMissionTimeGateEnabled,
};

const KST_CALENDAR_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const TERMINAL_MISSION_STATUSES = new Set(["COMPLETED", "SAFETY_PAUSED", "FORCE_ENDED"]);

const getKstCalendarParts = (now: Date): {
  businessDate: string;
  currentMinute: number;
} => {
  const parts = new Map(
    KST_CALENDAR_FORMATTER
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const year = parts.get("year");
  const month = parts.get("month");
  const day = parts.get("day");
  const hour = Number(parts.get("hour"));
  const minute = Number(parts.get("minute"));

  if (!year || !month || !day || !Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error("KST 미션 캘린더 시각을 계산할 수 없습니다.");
  }

  return {
    businessDate: `${year}-${month}-${day}`,
    currentMinute: hour * 60 + minute,
  };
};

const isV3PolicyEffective = (
  policy: MissionPolicySnapshot,
  now: Date,
): policy is MissionPolicySnapshot & {
  missionPolicyVersion: "v3_single_daily";
  effectiveAt: string;
} => {
  if (policy.missionPolicyVersion !== "v3_single_daily" || !policy.effectiveAt) return false;
  const effectiveAtMs = Date.parse(policy.effectiveAt);
  if (!Number.isFinite(effectiveAtMs)) {
    throw new Error("Mission v3 effective_at이 올바른 timestamp 형식이 아닙니다.");
  }
  return now.getTime() >= effectiveAtMs;
};

export const evaluateMissionTimeGate = async (input: {
  db: SupabaseClient;
  childId: string;
  now?: Date;
  dependencies?: Partial<MissionTimePolicyDependencies>;
}): Promise<MissionTimeGateResult> => {
  const now = input.now ?? new Date();
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...input.dependencies };
  const { businessDate, currentMinute } = getKstCalendarParts(now);
  const scheduleEnforced = dependencies.isMissionScheduleEnforced();
  const timeGateEnabled = dependencies.isMissionTimeGateEnabled?.()
    ?? (process.env.MISSION_TIME_GATE_ENABLED === "true");

  // 1. MISSION_SCHEDULE_ENFORCED=true: 09:00 inclusive ~ 23:50 exclusive
  if (scheduleEnforced) {
    const opensAtMinute = 540;
    const closesAtMinute = 1430;
    const allowed = currentMinute >= opensAtMinute && currentMinute < closesAtMinute;

    return {
      allowed,
      businessDate,
      currentMinute,
      opensAtMinute,
      closesAtMinute,
      scheduleEnforced: true,
      timeGateEnabled,
      reason: allowed
        ? null
        : currentMinute < opensAtMinute
          ? "before_open"
          : "closed",
      displayKey: allowed
        ? null
        : currentMinute < opensAtMinute
          ? "before_open"
          : "closed",
    };
  }

  // 2. MISSION_SCHEDULE_ENFORCED=false && MISSION_TIME_GATE_ENABLED=true: legacy currentRound windows
  //    Window 1 (round1_day): 10:00 (600) ~ 17:50 (1070)
  //    Window 2 (round2_night): 18:00 (1080) ~ 24:00 (1440)
  if (timeGateEnabled) {
    const hour = Math.floor(currentMinute / 60);
    const minute = currentMinute % 60;
    const round = currentRound(hour, false, minute);

    if (round === "round1_day") {
      return {
        allowed: true,
        businessDate,
        currentMinute,
        opensAtMinute: 600,
        closesAtMinute: 1070,
        scheduleEnforced: false,
        timeGateEnabled: true,
        reason: null,
        displayKey: null,
      };
    }

    if (round === "round2_night") {
      return {
        allowed: true,
        businessDate,
        currentMinute,
        opensAtMinute: 1080,
        closesAtMinute: 1440,
        scheduleEnforced: false,
        timeGateEnabled: true,
        reason: null,
        displayKey: null,
      };
    }

    // round === null (outside legacy windows)
    const isBeforeRound1 = currentMinute < 600;
    const isBetweenRounds = currentMinute >= 1070 && currentMinute < 1080;

    return {
      allowed: false,
      businessDate,
      currentMinute,
      opensAtMinute: isBeforeRound1 ? 600 : 1080,
      closesAtMinute: isBeforeRound1 ? 1070 : 1440,
      scheduleEnforced: false,
      timeGateEnabled: true,
      reason: "before_open",
      displayKey: isBetweenRounds ? "between_rounds" : isBeforeRound1 ? "before_open" : "closed",
    };
  }

  // 3. 둘 다 false: 24시간 신규 시작 허용
  return {
    allowed: true,
    businessDate,
    currentMinute,
    opensAtMinute: 540,
    closesAtMinute: 1430,
    scheduleEnforced: false,
    timeGateEnabled: false,
    reason: null,
    displayKey: null,
  };
};

const findDailySingleProgress = async (
  db: SupabaseClient,
  childId: string,
  businessDate: string,
): Promise<DailySingleProgressRow | null> => {
  const { data, error } = await db
    .from("mission_progress")
    .select("session_id, status, mission_policy_version, effective_at")
    .eq("child_id", childId)
    .eq("business_date", businessDate)
    .eq("round_type", "daily_single")
    .maybeSingle();

  if (error) {
    throw new Error(`daily_single 미션 조회 실패: ${error.message}`);
  }
  return data as DailySingleProgressRow | null;
};

/**
 * Resolves the only three valid Phase 3 outcomes before a route creates a session.
 * Existing non-terminal sessions are resumable even outside the start window.
 * Completed/safety-paused/force-ended rows consume the day's single creation allowance.
 */
export const decideDailySingleOperation = async (input: {
  db: SupabaseClient;
  childId: string;
  policy: MissionPolicySnapshot;
  now?: Date;
  dependencies?: Partial<MissionTimePolicyDependencies>;
}): Promise<DailySingleOperationDecision> => {
  const now = input.now ?? new Date();
  const { businessDate } = getKstCalendarParts(now);
  const existing = await findDailySingleProgress(input.db, input.childId, businessDate);

  if (existing) {
    if (!TERMINAL_MISSION_STATUSES.has(existing.status ?? "")) {
      return { action: "resume", sessionId: existing.session_id, businessDate };
    }
    return {
      action: "blocked",
      reason: "daily_limit_reached",
      businessDate,
      existingSessionId: existing.session_id,
    };
  }

  if (!isV3PolicyEffective(input.policy, now)) {
    return { action: "blocked", reason: "policy_not_effective", businessDate };
  }

  const gate = await evaluateMissionTimeGate({
    db: input.db,
    childId: input.childId,
    now,
    dependencies: input.dependencies,
  });
  if (!gate.allowed) {
    return { action: "blocked", reason: gate.reason ?? "closed", businessDate, gate };
  }

  return {
    action: "create",
    businessDate,
    missionPolicyVersion: "v3_single_daily",
    effectiveAt: input.policy.effectiveAt,
    gate,
  };
};
