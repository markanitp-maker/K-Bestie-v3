import type {
  MissionEntrySnapshot,
  MissionEntryState,
} from "./entryContract.js";

export type MissionDestinationKind = "v3" | "v2" | "blocked";

export type MissionBlockedReason =
  | "completed"
  | "safety_paused"
  | "force_ended"
  | "before_open"
  | "closed"
  | "unavailable";

export interface MissionDestination {
  kind: MissionDestinationKind;
  reason?: MissionBlockedReason;
  entryState?: MissionEntryState;
}

export interface MissionDisplay {
  title: string;
  description: string;
  bubble: string | null;
  badge: string | null;
}

const VALID_POLICY_VERSIONS: ReadonlySet<string> = new Set([
  "v2_dual",
  "v3_single_daily",
]);

const VALID_ENTRY_STATES: ReadonlySet<string> = new Set([
  "start",
  "resume",
  "completed",
  "safety_paused",
  "force_ended",
  "before_open",
  "closed",
  "unavailable",
]);

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "IN_PROGRESS",
  "COMPLETED",
  "SAFETY_PAUSED",
  "FORCE_ENDED",
]);

const VALID_BLOCK_REASONS: ReadonlySet<string> = new Set([
  "before_open",
  "closed",
  "daily_limit_reached",
  "unavailable",
]);

const VALID_PROGRESS_KINDS: ReadonlySet<string> = new Set([
  "valid_answers",
  "conversation_goals",
]);

const VALID_TIMEGATE_REASONS: ReadonlySet<string> = new Set([
  "before_open",
  "closed",
]);

/**
 * 1. parseMissionEntrySnapshot
 * 서버가 반환한 raw 응답의 런타임 스키마 및 terminal/시간 불변식을 검증한다.
 * 규약에 맞지 않거나 계약 위반인 경우 null을 반환하여 fail-closed 처리한다.
 */
export function parseMissionEntrySnapshot(
  raw: unknown,
): MissionEntrySnapshot | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }

  const obj = raw as Record<string, unknown>;

  // 1. policyVersion
  if (
    typeof obj.policyVersion !== "string" ||
    !VALID_POLICY_VERSIONS.has(obj.policyVersion)
  ) {
    return null;
  }
  const policyVersion = obj.policyVersion as "v2_dual" | "v3_single_daily";

  // 2. effectiveAt
  if (obj.effectiveAt !== null && typeof obj.effectiveAt !== "string") {
    return null;
  }
  const effectiveAt = obj.effectiveAt;

  // 3. businessDate
  if (typeof obj.businessDate !== "string" || obj.businessDate.trim() === "") {
    return null;
  }
  const businessDate = obj.businessDate;

  // 4. entryState
  if (
    typeof obj.entryState !== "string" ||
    !VALID_ENTRY_STATES.has(obj.entryState)
  ) {
    return null;
  }
  const entryState = obj.entryState as MissionEntryState;

  // 5. canEnter & canStartNew
  if (
    typeof obj.canEnter !== "boolean" ||
    typeof obj.canStartNew !== "boolean"
  ) {
    return null;
  }
  const canEnter = obj.canEnter;
  const canStartNew = obj.canStartNew;

  // 6. sessionId
  if (obj.sessionId !== null && typeof obj.sessionId !== "string") {
    return null;
  }
  const sessionId = obj.sessionId;

  // 7. status
  if (
    obj.status !== null &&
    (typeof obj.status !== "string" || !VALID_STATUSES.has(obj.status))
  ) {
    return null;
  }
  const status = obj.status as
    | "IN_PROGRESS"
    | "COMPLETED"
    | "SAFETY_PAUSED"
    | "FORCE_ENDED"
    | null;

  // 8. completed
  if (typeof obj.completed !== "boolean") {
    return null;
  }
  const completed = obj.completed;

  // 9. blockReason
  if (
    obj.blockReason !== null &&
    (typeof obj.blockReason !== "string" ||
      !VALID_BLOCK_REASONS.has(obj.blockReason))
  ) {
    return null;
  }
  const blockReason = obj.blockReason as
    | "before_open"
    | "closed"
    | "daily_limit_reached"
    | "unavailable"
    | null;

  // 10. progress
  let progress: MissionEntrySnapshot["progress"] = null;
  if (obj.progress !== null && obj.progress !== undefined) {
    if (typeof obj.progress !== "object" || Array.isArray(obj.progress)) {
      return null;
    }
    const prog = obj.progress as Record<string, unknown>;
    if (
      typeof prog.kind !== "string" ||
      !VALID_PROGRESS_KINDS.has(prog.kind) ||
      typeof prog.current !== "number" ||
      !Number.isFinite(prog.current) ||
      prog.current < 0 ||
      typeof prog.target !== "number" ||
      !Number.isFinite(prog.target) ||
      prog.target <= 0
    ) {
      return null;
    }
    progress = {
      kind: prog.kind as "valid_answers" | "conversation_goals",
      current: prog.current,
      target: prog.target,
    };
  }

  // 11. timeGate
  if (
    typeof obj.timeGate !== "object" ||
    obj.timeGate === null ||
    Array.isArray(obj.timeGate)
  ) {
    return null;
  }
  const tg = obj.timeGate as Record<string, unknown>;
  if (
    typeof tg.enabled !== "boolean" ||
    typeof tg.allowedForNewStart !== "boolean" ||
    typeof tg.scheduleEnforced !== "boolean" ||
    (tg.reason !== null &&
      (typeof tg.reason !== "string" || !VALID_TIMEGATE_REASONS.has(tg.reason)))
  ) {
    return null;
  }
  const timeGate: MissionEntrySnapshot["timeGate"] = {
    enabled: tg.enabled,
    allowedForNewStart: tg.allowedForNewStart,
    scheduleEnforced: tg.scheduleEnforced,
    reason: tg.reason as "before_open" | "closed" | null,
  };

  // ==========================================
  // Invariant / Contract / Fail-Closed Checks
  // ==========================================

  // (1) completed ↔ status identity: completed는 오직 status === "COMPLETED"일 때만 true
  if (completed !== (status === "COMPLETED")) {
    return null;
  }

  // (2) daily_limit_reached vs terminal status: daily_limit_reached면 반드시 COMPLETED / SAFETY_PAUSED / FORCE_ENDED 중 하나
  if (blockReason === "daily_limit_reached") {
    if (
      status !== "COMPLETED" &&
      status !== "SAFETY_PAUSED" &&
      status !== "FORCE_ENDED"
    ) {
      return null;
    }
  }

  // (3) canEnter invariant: start 또는 resume일 때만 true
  const isStartOrResume = entryState === "start" || entryState === "resume";
  if (canEnter !== isStartOrResume) {
    return null;
  }

  // (4) canStartNew invariant: start일 때만 true
  if (canStartNew !== (entryState === "start")) {
    return null;
  }

  // (5) entryState consistency checks
  switch (entryState) {
    case "completed":
      if (
        status !== "COMPLETED" ||
        !completed ||
        blockReason !== "daily_limit_reached"
      ) {
        return null;
      }
      break;

    case "safety_paused":
      if (
        status !== "SAFETY_PAUSED" ||
        completed ||
        blockReason !== "daily_limit_reached"
      ) {
        return null;
      }
      break;

    case "force_ended":
      if (
        status !== "FORCE_ENDED" ||
        completed ||
        blockReason !== "daily_limit_reached"
      ) {
        return null;
      }
      break;

    case "resume":
      if (
        status !== "IN_PROGRESS" ||
        completed ||
        blockReason !== null ||
        !sessionId
      ) {
        return null;
      }
      break;

    case "start":
      if (
        status !== null ||
        completed ||
        blockReason !== null ||
        sessionId !== null
      ) {
        return null;
      }
      break;

    case "before_open":
      if (blockReason !== "before_open" || canEnter || canStartNew) {
        return null;
      }
      break;

    case "closed":
      if (blockReason !== "closed" || canEnter || canStartNew) {
        return null;
      }
      break;

    case "unavailable":
      if (
        blockReason !== "unavailable" ||
        canEnter ||
        canStartNew ||
        completed
      ) {
        return null;
      }
      break;

    default:
      return null;
  }

  return {
    policyVersion,
    effectiveAt,
    businessDate,
    entryState,
    canEnter,
    canStartNew,
    sessionId,
    status,
    completed,
    blockReason,
    progress,
    timeGate,
  };
}

/**
 * 2. resolveMissionDestination
 * snapshot의 policyVersion과 entryState를 근거로 목적지 화면/차단 여부를 확정한다.
 * 클라이언트가 시간을 재계산하거나 정책을 임의 추정하지 않는다.
 */
export function resolveMissionDestination(
  snapshot: MissionEntrySnapshot | null | undefined,
): MissionDestination {
  if (!snapshot || snapshot.entryState === "unavailable") {
    return {
      kind: "blocked",
      reason: "unavailable",
      entryState: "unavailable",
    };
  }

  if (snapshot.canEnter) {
    if (snapshot.policyVersion === "v3_single_daily") {
      return { kind: "v3", entryState: snapshot.entryState };
    }
    if (snapshot.policyVersion === "v2_dual") {
      return { kind: "v2", entryState: snapshot.entryState };
    }
    return {
      kind: "blocked",
      reason: "unavailable",
      entryState: "unavailable",
    };
  }

  // 여기 도달하면 entryState는 이미 start/resume이 아니다(위에서 조기 반환).
  // 남은 값은 전부 blocked 사유이므로 그대로 쓰고, 예상 밖 값은 fail-closed 한다.
  const BLOCKED_REASONS: readonly MissionBlockedReason[] = [
    "completed",
    "safety_paused",
    "force_ended",
    "before_open",
    "closed",
    "unavailable",
  ];
  const reason: MissionBlockedReason = BLOCKED_REASONS.includes(
    snapshot.entryState as MissionBlockedReason,
  )
    ? (snapshot.entryState as MissionBlockedReason)
    : "unavailable";

  return {
    kind: "blocked",
    reason,
    entryState: snapshot.entryState,
  };
}

/**
 * 3. resolveMissionDisplay
 * 설계 §4(terminal 표시 계약) 및 §3(시간 게이트 문구) 표를 충실히 구현한다.
 * safety_paused / force_ended 에는 절대 완료 배지나 보상 표시를 붙이지 않는다.
 */
export function resolveMissionDisplay(
  snapshot: MissionEntrySnapshot | null | undefined,
): MissionDisplay {
  if (!snapshot || snapshot.entryState === "unavailable") {
    return {
      title: "미션 진행",
      description: "미션 상태를 확인하지 못했어요.",
      bubble: "미션 상태를 확인하지 못했어요.",
      badge: null,
    };
  }

  switch (snapshot.entryState) {
    case "completed":
      return {
        title: "미션 완료",
        description: "오늘의 미션을 모두 완료했어요",
        bubble: "오늘의 미션을 모두 완료했어!",
        badge: "완료",
      };

    case "safety_paused":
      return {
        title: "미션 잠시 쉬기",
        description: "안전을 위해 오늘 미션을 잠시 쉬어요",
        bubble: "오늘은 미션을 잠시 쉬어 갈게.",
        badge: null,
      };

    case "force_ended":
      return {
        title: "오늘 미션 종료",
        description: "오늘 미션은 여기까지예요",
        bubble: "오늘 미션은 여기까지야. 내일 다시 만나자!",
        badge: null,
      };

    case "resume": {
      const badge =
        snapshot.progress !== null && snapshot.progress !== undefined
          ? `${snapshot.progress.current}/${snapshot.progress.target}`
          : null;
      return {
        title: "미션 계속하기",
        description: "진행 중인 미션을 이어서 해요",
        bubble: null,
        badge,
      };
    }

    case "start":
      return {
        title: "미션 진행",
        description: "오늘의 미션을 시작해요",
        bubble: null,
        badge: null,
      };

    case "before_open":
      return {
        title: "미션 진행",
        description: "오늘의 미션을 시작해요",
        bubble: "아직 미션 시간이 아니야.",
        badge: null,
      };

    case "closed":
      return {
        title: "미션 진행",
        description: "오늘의 미션을 시작해요",
        bubble: "오늘 미션 시간이 끝났어.",
        badge: null,
      };

    default:
      return {
        title: "미션 진행",
        description: "미션 상태를 확인하지 못했어요.",
        bubble: "미션 상태를 확인하지 못했어요.",
        badge: null,
      };
  }
}
