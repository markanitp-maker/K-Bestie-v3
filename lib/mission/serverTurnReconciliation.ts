export type MissionTurnRecord = {
  status: string;
  question_id: string;
  child_message_id: string | null;
  k_message_id: string | null;
  answer_result: Record<string, unknown> | null;
};

export type MissionProgressRecord = {
  question_states: Record<string, unknown> | null;
};

export type MissionMessageRecord = {
  id: string;
  turn_id: string | null;
  role: "child" | "k";
};

export type ServerTurnReconciliation = {
  status: "committed" | "not_committed" | "unknown";
  turnStatus: string;
  childCommitted: boolean;
  answerCommitted: boolean;
  progressCommitted: boolean;
  kCommitted: boolean;
};

export type MissionTurnRecoveryState = Record<string, unknown>;

const RECOVERY_STATE_KEYS = [
  "questionStates",
  "validAnswerCount",
  "progressPercent",
  "requiredCount",
  "engine_version",
  "questions",
  "questionIds",
  "questionPoolExhausted",
  "clarificationText",
  "valid",
  "reason",
  "refused",
] as const;

export function extractMissionTurnRecoveryState(
  answerResult: Record<string, unknown> | null,
): MissionTurnRecoveryState | null {
  if (!answerResult) return null;

  const recoveryState: MissionTurnRecoveryState = {};
  for (const key of RECOVERY_STATE_KEYS) {
    if (key in answerResult) recoveryState[key] = answerResult[key];
  }
  return Object.keys(recoveryState).length > 0 ? recoveryState : null;
}

export function mergeMissionStartWithTurnRecovery<T extends Record<string, unknown>>(
  startData: T,
  recoveryState: MissionTurnRecoveryState | null,
): T {
  if (!recoveryState) return startData;
  return {
    ...startData,
    ...recoveryState,
    sessionId: startData.sessionId,
    resumed: true,
  };
}

type ReconciliationSnapshot = {
  clientTurnId: string;
  questionId: string;
  turn: MissionTurnRecord | null;
  progress: MissionProgressRecord | null;
  messages: MissionMessageRecord[];
};

export function classifyServerTurnSnapshot({
  clientTurnId,
  questionId,
  turn,
  progress,
  messages,
}: ReconciliationSnapshot): ServerTurnReconciliation {
  const childMessage = messages.find((message) => message.turn_id === clientTurnId && message.role === "child");
  const kMessage = messages.find((message) => message.turn_id === `${clientTurnId}:k` && message.role === "k");
  const questionState = progress?.question_states?.[questionId];
  const progressCommitted = typeof questionState === "string" && questionState !== "pending";
  const childCommitted = Boolean(
    turn
    && turn.question_id === questionId
    && turn.child_message_id
    && childMessage?.id === turn.child_message_id,
  );
  const answerCommitted = Boolean(
    turn?.answer_result
    && (turn.status === "ANSWER_PROCESSED" || turn.status === "FINALIZED"),
  );
  const kCommitted = Boolean(
    turn?.status === "FINALIZED"
    && turn.k_message_id
    && kMessage?.id === turn.k_message_id,
  );

  let status: ServerTurnReconciliation["status"] = "unknown";
  if (kCommitted || (childCommitted && answerCommitted && progressCommitted)) {
    status = "committed";
  } else if (!turn && !childMessage && !kMessage && !progressCommitted) {
    status = "not_committed";
  }

  return {
    status,
    turnStatus: turn?.status ?? "missing",
    childCommitted,
    answerCommitted,
    progressCommitted,
    kCommitted,
  };
}
