import type { ParentConversationTurn } from "@/lib/parentKChat/parentKnowledgeRetrieval";
import type { ParentTemporalResolution } from "@/lib/parentKChat/temporalQuery";

export type ParentAnswerStatus = "EVIDENCE_FOUND" | "PARTIAL_EVIDENCE" | "NO_DATA" | "SYSTEM_ERROR";

export interface ParentAskChildContext {
  proposal: string;
  requestedTopic: string;
  lastUnknownDetail: string;
  targetDate: string | null;
}

function koreanDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

export function answerForUnavailable(status: "NO_DATA" | "SYSTEM_ERROR", temporal: ParentTemporalResolution): string {
  if (status === "SYSTEM_ERROR") return "지금은 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";
  if (temporal.kind === "EXACT_DATE" && temporal.targetDate) return "그 날짜에 확인되는 기록이 없어요.";
  return "그 내용은 아직 확인되는 기록에 없어요.";
}

export function buildAskChildContext(
  parentQuestion: string,
  temporal: ParentTemporalResolution,
  unknownDetail = parentQuestion,
): ParentAskChildContext {
  const detail = unknownDetail.trim().slice(0, 160) || parentQuestion.trim().slice(0, 160);
  const datePrefix = temporal.targetDate
    ? `${koreanDate(temporal.targetDate)}에 `
    : temporal.label
      ? `${temporal.label} `
      : "";
  const proposal = `${datePrefix}${detail}`.trim().slice(0, 300);
  return {
    proposal,
    requestedTopic: detail.slice(0, 120),
    lastUnknownDetail: detail,
    targetDate: temporal.targetDate,
  };
}

export function findPreviousParentInformationQuery(context: ParentConversationTurn[]): string | null {
  const candidate = [...context]
    .reverse()
    .find((turn) => turn.role === "user" && !/^(안녕|고마워|감사|물어\s*봐|여쭤\s*봐)/.test(turn.text.trim()));
  return candidate?.text.trim().slice(0, 300) || null;
}

export function buildCorrectionRetrievalQuery(correction: string, previousQuery: string): string {
  return `${previousQuery}\n부모 정정: ${correction}`.slice(0, 600);
}

export function latestAskChildContext(context: ParentConversationTurn[]): ParentAskChildContext | null {
  const turn = [...context]
    .reverse()
    .find((item) => item.role === "k" && (item.askChildProposal || item.lastUnknownDetail));
  if (!turn) return null;
  const detail = (turn.lastUnknownDetail || turn.askChildProposal || "").trim();
  if (!detail) return null;
  return {
    proposal: (turn.askChildProposal || detail).slice(0, 300),
    requestedTopic: detail.slice(0, 120),
    lastUnknownDetail: detail.slice(0, 160),
    targetDate: turn.targetDate || null,
  };
}

export function isForbiddenGenericEvidenceFallback(answer: string): boolean {
  return /관련된 기록은 일부 확인|답할 만큼 근거가 충분하지|확인된 범위를 더 구체적으로/.test(answer);
}

export function partialEvidenceFallback(context: ParentAskChildContext): string {
  const dateText = context.targetDate ? `${koreanDate(context.targetDate)} 기록에서 관련 내용은 확인했지만` : "관련 내용은 확인했지만";
  return `${dateText}, ${context.lastUnknownDetail}에 대한 세부 내용은 기록에 없어요. 아이에게 직접 물어볼까요?`;
}
