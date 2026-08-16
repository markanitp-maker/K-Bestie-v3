import {
  countSatisfiedGoals,
  getCompletionThreshold,
  type ConversationGoal,
} from "@/lib/mission-v3/goalEngine";
import type { MissionTimeGateDisplayKey } from "@/lib/mission-v3/timePolicy";

export type MissionEntryState =
  | "start"
  | "resume"
  | "completed"
  | "safety_paused"
  | "force_ended"
  | "before_open"
  | "closed"
  | "unavailable";

export interface MissionEntrySnapshot {
  policyVersion: "v2_dual" | "v3_single_daily";
  effectiveAt: string | null;
  businessDate: string;
  entryState: MissionEntryState;
  canEnter: boolean;       // start 또는 resume일 때만 true
  canStartNew: boolean;    // start일 때만 true
  sessionId: string | null;
  status: "IN_PROGRESS" | "COMPLETED" | "SAFETY_PAUSED" | "FORCE_ENDED" | null;
  completed: boolean;      // status === COMPLETED와 항상 동치
  blockReason: "before_open" | "closed" | "daily_limit_reached" | "unavailable" | null;
  progress: null | {
    kind: "valid_answers" | "conversation_goals";
    current: number;
    target: number;
  };
  timeGate: {
    enabled: boolean;
    allowedForNewStart: boolean;
    scheduleEnforced: boolean;
    reason: "before_open" | "closed" | null;
  };
}

export type MissionProgressKind = "valid_answers" | "conversation_goals";

export interface NormalizedMissionProgress {
  kind: MissionProgressKind;
  current: number;
  target: number;
}

export interface RawSessionInput {
  sessionId: string;
  status: string | null;
  progress: NormalizedMissionProgress | null;
}

export interface TimeGateInput {
  enabled: boolean;
  allowedForNewStart: boolean;
  scheduleEnforced: boolean;
  reason: "before_open" | "closed" | null;
  displayKey?: MissionTimeGateDisplayKey;
}

export interface BuildMissionEntrySnapshotInput {
  policyVersion: "v2_dual" | "v3_single_daily";
  effectiveAt: string | null;
  businessDate: string;
  isMixed?: boolean;
  session: RawSessionInput | null;
  timeGate: TimeGateInput;
}

export const TERMINAL_STATUS_SET: ReadonlySet<string> = new Set([
  "COMPLETED",
  "SAFETY_PAUSED",
  "FORCE_ENDED",
]);

export function normalizeMissionStatus(
  status: string | null | undefined,
): "IN_PROGRESS" | "COMPLETED" | "SAFETY_PAUSED" | "FORCE_ENDED" | null {
  if (!status) return null;
  const upper = status.trim().toUpperCase();
  if (upper === "COMPLETED") return "COMPLETED";
  if (upper === "SAFETY_PAUSED") return "SAFETY_PAUSED";
  if (upper === "FORCE_ENDED") return "FORCE_ENDED";
  if (upper === "IN_PROGRESS") return "IN_PROGRESS";
  return null;
}

export function buildV2Progress(
  validAnswerCount: number | null | undefined,
  requiredValidCount: number | null | undefined,
): NormalizedMissionProgress {
  return {
    kind: "valid_answers",
    current: validAnswerCount ?? 0,
    target: requiredValidCount ?? 10,
  };
}

export function buildV3Progress(
  goals: ConversationGoal[],
): NormalizedMissionProgress {
  return {
    kind: "conversation_goals",
    current: countSatisfiedGoals(goals),
    target: getCompletionThreshold(goals),
  };
}

export function buildMissionEntrySnapshot(
  input: BuildMissionEntrySnapshotInput,
): MissionEntrySnapshot {
  // 1. 혼합 정책 (isMixed) -> unavailable fail-closed
  if (input.isMixed) {
    return {
      policyVersion: input.policyVersion,
      effectiveAt: input.effectiveAt,
      businessDate: input.businessDate,
      entryState: "unavailable",
      canEnter: false,
      canStartNew: false,
      sessionId: null,
      status: null,
      completed: false,
      blockReason: "unavailable",
      progress: null,
      timeGate: {
        enabled: input.timeGate.enabled,
        allowedForNewStart: false,
        scheduleEnforced: input.timeGate.scheduleEnforced,
        reason: input.timeGate.reason,
      },
    };
  }

  // 2. 당일 세션이 있는 경우
  if (input.session && input.session.sessionId) {
    const rawStatus = input.session.status;
    const normalizedStatus = normalizeMissionStatus(rawStatus);

    let entryState: MissionEntryState;
    let blockReason: "before_open" | "closed" | "daily_limit_reached" | "unavailable" | null = null;
    let canEnter = false;
    let canStartNew = false;
    let resolvedStatus: "IN_PROGRESS" | "COMPLETED" | "SAFETY_PAUSED" | "FORCE_ENDED" | null = null;
    let isCompleted = false;

    if (normalizedStatus === "COMPLETED") {
      entryState = "completed";
      blockReason = "daily_limit_reached";
      resolvedStatus = "COMPLETED";
      isCompleted = true;
    } else if (normalizedStatus === "SAFETY_PAUSED") {
      entryState = "safety_paused";
      blockReason = "daily_limit_reached";
      resolvedStatus = "SAFETY_PAUSED";
      isCompleted = false;
    } else if (normalizedStatus === "FORCE_ENDED") {
      entryState = "force_ended";
      blockReason = "daily_limit_reached";
      resolvedStatus = "FORCE_ENDED";
      isCompleted = false;
    } else if (normalizedStatus === "IN_PROGRESS") {
      entryState = "resume";
      canEnter = true;
      canStartNew = false;
      blockReason = null;
      resolvedStatus = "IN_PROGRESS";
      isCompleted = false;
    } else if (rawStatus === null || rawStatus === undefined || rawStatus === "") {
      // Legacy V1 data without explicit status: determine by progress counts
      const progress = input.session.progress;
      const hasValidCount =
        progress !== null &&
        progress !== undefined &&
        typeof progress.current === "number" &&
        typeof progress.target === "number" &&
        Number.isFinite(progress.current) &&
        Number.isFinite(progress.target) &&
        progress.target > 0;

      if (hasValidCount) {
        if (progress.current >= progress.target) {
          entryState = "completed";
          blockReason = "daily_limit_reached";
          resolvedStatus = "COMPLETED";
          isCompleted = true;
        } else {
          entryState = "resume";
          canEnter = true;
          canStartNew = false;
          blockReason = null;
          resolvedStatus = "IN_PROGRESS";
          isCompleted = false;
        }
      } else {
        // status is null and no valid progress count -> uninterpretable -> fail-closed
        entryState = "unavailable";
        blockReason = "unavailable";
        resolvedStatus = null;
        isCompleted = false;
      }
    } else {
      // Non-null unrecognized status (e.g. "WEIRD") -> fail-closed to unavailable without promoting
      entryState = "unavailable";
      blockReason = "unavailable";
      resolvedStatus = null;
      isCompleted = false;
    }

    return {
      policyVersion: input.policyVersion,
      effectiveAt: input.effectiveAt,
      businessDate: input.businessDate,
      entryState,
      canEnter,
      canStartNew,
      sessionId: entryState === "unavailable" ? null : input.session.sessionId,
      status: resolvedStatus,
      completed: isCompleted,
      blockReason,
      progress: input.session.progress,
      timeGate: {
        enabled: input.timeGate.enabled,
        allowedForNewStart: input.timeGate.allowedForNewStart,
        scheduleEnforced: input.timeGate.scheduleEnforced,
        reason: input.timeGate.reason,
      },
    };
  }

  // 3. 당일 세션이 없는 경우
  let entryState: MissionEntryState;
  let blockReason: "before_open" | "closed" | "daily_limit_reached" | "unavailable" | null = null;
  let canEnter = false;
  let canStartNew = false;

  if (input.timeGate.allowedForNewStart) {
    entryState = "start";
    canEnter = true;
    canStartNew = true;
    blockReason = null;
  } else if (input.timeGate.reason === "before_open") {
    entryState = "before_open";
    blockReason = "before_open";
    canEnter = false;
    canStartNew = false;
  } else if (input.timeGate.reason === "closed") {
    entryState = "closed";
    blockReason = "closed";
    canEnter = false;
    canStartNew = false;
  } else {
    // allowedForNewStart is false, but reason is missing -> fail-closed to unavailable without displayKey inference
    entryState = "unavailable";
    blockReason = "unavailable";
    canEnter = false;
    canStartNew = false;
  }

  return {
    policyVersion: input.policyVersion,
    effectiveAt: input.effectiveAt,
    businessDate: input.businessDate,
    entryState,
    canEnter,
    canStartNew,
    sessionId: null,
    status: null,
    completed: false,
    blockReason,
    progress: null,
    timeGate: {
      enabled: input.timeGate.enabled,
      allowedForNewStart: input.timeGate.allowedForNewStart,
      scheduleEnforced: input.timeGate.scheduleEnforced,
      reason: input.timeGate.reason,
    },
  };
}

export function buildUnavailableSnapshot(input: {
  businessDate?: string;
  policyVersion?: "v2_dual" | "v3_single_daily";
  effectiveAt?: string | null;
  timeGate?: Partial<MissionEntrySnapshot["timeGate"]>;
}): MissionEntrySnapshot {
  return {
    policyVersion: input.policyVersion ?? "v2_dual",
    effectiveAt: input.effectiveAt ?? null,
    businessDate: input.businessDate ?? "",
    entryState: "unavailable",
    canEnter: false,
    canStartNew: false,
    sessionId: null,
    status: null,
    completed: false,
    blockReason: "unavailable",
    progress: null,
    timeGate: {
      enabled: input.timeGate?.enabled ?? false,
      allowedForNewStart: false,
      scheduleEnforced: input.timeGate?.scheduleEnforced ?? false,
      reason: input.timeGate?.reason ?? null,
    },
  };
}
