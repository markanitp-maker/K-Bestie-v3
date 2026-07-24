export const PLAY_KEY_COSTS = {
  comic_book: 2,
  quiz: 2,
  hairstyle: 3,
  mbti: 3,
} as const;

export type PlayType = keyof typeof PLAY_KEY_COSTS;

export const AUTO_REFUND_STAGES = new Set(["init"]);

export type PlayEnvelope = {
  playType: PlayType;
  eventType: string;
  occurredAt: string;
};

// 메인 -> iframe
export type MbtiInitPayload = PlayEnvelope & {
  eventType: "MBTI_INIT";
  playSessionId: string;
  childId: string;
  startMode: "new" | "resume";
  expiresAt: string;
};

// iframe -> 메인
export type MbtiReadyPayload = PlayEnvelope & {
  eventType: "MBTI_READY";
};

export type MbtiInitAckPayload = PlayEnvelope & {
  eventType: "MBTI_INIT_ACK";
  playSessionId: string;
};

export type MbtiProgressPayload = PlayEnvelope & {
  eventType: "MBTI_PROGRESS";
  playSessionId: string;
  progressPercent: number;
};

export type MbtiCompletedPayload = PlayEnvelope & {
  eventType: "MBTI_COMPLETED";
  playSessionId: string;
  resultType: string;
};

export type MbtiErrorPayload = PlayEnvelope & {
  eventType: "MBTI_ERROR";
  playSessionId: string;
  childId: string;
  stage: "init" | "first_question" | "in_progress" | "result";
  errorCode: string;
  errorMessage: string;
  networkStatus: string;
  dbStatus: string;
  browserOS: string;
};

export type MbtiCloseRequestPayload = PlayEnvelope & {
  eventType: "MBTI_CLOSE_REQUEST";
  playSessionId: string;
};

export type PlayBugReportPayload = PlayEnvelope & {
  eventType: "PLAY_BUG_REPORT";
  sessionId: string; // !필드명 주의 (playSessionId 아님)
  childId: string;
  stage: string;
  questionNumber: number | null;
  errorMessage: string;
  networkStatus: string;
  dbStatus: string;
  browserOS: string;
};

// Runtime guards
function isEnvelope(data: any): data is PlayEnvelope {
  return (
    data &&
    typeof data === "object" &&
    typeof data.playType === "string" &&
    typeof data.eventType === "string" &&
    typeof data.occurredAt === "string"
  );
}

export function isMbtiInitCandidate(data: any): data is MbtiInitPayload {
  return (
    isEnvelope(data) &&
    data.eventType === "MBTI_INIT" &&
    data.playType === "mbti" &&
    typeof (data as any).playSessionId === "string" &&
    typeof (data as any).childId === "string" &&
    ((data as any).startMode === "new" || (data as any).startMode === "resume") &&
    typeof (data as any).expiresAt === "string"
  );
}

export function isMbtiReady(data: any): data is MbtiReadyPayload {
  return isEnvelope(data) && data.eventType === "MBTI_READY" && data.playType === "mbti";
}

export function isMbtiInitAck(data: any): data is MbtiInitAckPayload {
  return (
    isEnvelope(data) &&
    data.eventType === "MBTI_INIT_ACK" &&
    data.playType === "mbti" &&
    typeof (data as any).playSessionId === "string"
  );
}

export function isMbtiProgress(data: any): data is MbtiProgressPayload {
  return (
    isEnvelope(data) &&
    data.eventType === "MBTI_PROGRESS" &&
    data.playType === "mbti" &&
    typeof (data as any).playSessionId === "string" &&
    typeof (data as any).progressPercent === "number"
  );
}

export function isMbtiCompleted(data: any): data is MbtiCompletedPayload {
  return (
    isEnvelope(data) &&
    data.eventType === "MBTI_COMPLETED" &&
    data.playType === "mbti" &&
    typeof (data as any).playSessionId === "string" &&
    typeof (data as any).resultType === "string"
  );
}

export function isMbtiError(data: any): data is MbtiErrorPayload {
  return (
    isEnvelope(data) &&
    data.eventType === "MBTI_ERROR" &&
    data.playType === "mbti" &&
    typeof (data as any).playSessionId === "string" &&
    typeof (data as any).childId === "string" &&
    typeof (data as any).stage === "string" &&
    typeof (data as any).errorCode === "string" &&
    typeof (data as any).errorMessage === "string" &&
    typeof (data as any).networkStatus === "string" &&
    typeof (data as any).dbStatus === "string" &&
    typeof (data as any).browserOS === "string"
  );
}

export function isMbtiCloseRequest(data: any): data is MbtiCloseRequestPayload {
  return (
    isEnvelope(data) &&
    data.eventType === "MBTI_CLOSE_REQUEST" &&
    data.playType === "mbti" &&
    typeof (data as any).playSessionId === "string"
  );
}

export function isPlayBugReport(data: any): data is PlayBugReportPayload {
  return (
    isEnvelope(data) &&
    data.eventType === "PLAY_BUG_REPORT" &&
    typeof (data as any).sessionId === "string" &&
    typeof (data as any).childId === "string" &&
    typeof (data as any).stage === "string" &&
    ((data as any).questionNumber === null || typeof (data as any).questionNumber === "number") &&
    typeof (data as any).errorMessage === "string" &&
    typeof (data as any).networkStatus === "string" &&
    typeof (data as any).dbStatus === "string" &&
    typeof (data as any).browserOS === "string"
  );
}
