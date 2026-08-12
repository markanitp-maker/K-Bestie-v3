import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getActiveVacationContext,
  type VacationContext,
} from "@/lib/plan/vacationSchoolContext";

export type MissionPolicyVersion = "v2_dual" | "v3_single_daily";
export type DailySingleBlockReason =
  | "policy_not_effective"
  | "before_open"
  | "closed"
  | "daily_limit_reached";

export interface MissionPolicySnapshot {
  missionPolicyVersion: MissionPolicyVersion;
  effectiveAt: string | null;
}

export interface MissionTimeGateResult {
  allowed: boolean;
  businessDate: string;
  currentMinute: number;
  opensAtMinute: 600 | 780;
  closesAtMinute: 1380;
  vacationStatus: VacationContext["status"] | null;
  reason: "before_open" | "closed" | null;
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

interface MissionTimePolicyDependencies {
  getActiveVacationContext: typeof getActiveVacationContext;
}

const DEFAULT_DEPENDENCIES: MissionTimePolicyDependencies = {
  getActiveVacationContext,
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
  const vacationContext = await dependencies.getActiveVacationContext(input.db, input.childId);
  const isConfirmedVacation = vacationContext?.status === "VACATION_CONFIRMED";
  const opensAtMinute = isConfirmedVacation ? 600 : 780;
  const closesAtMinute = 1380;

  return {
    allowed: currentMinute >= opensAtMinute && currentMinute < closesAtMinute,
    businessDate,
    currentMinute,
    opensAtMinute,
    closesAtMinute,
    vacationStatus: vacationContext?.status ?? null,
    reason:
      currentMinute < opensAtMinute
        ? "before_open"
        : currentMinute >= closesAtMinute
          ? "closed"
          : null,
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
