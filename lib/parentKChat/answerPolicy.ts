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
  if (temporal.kind === "EXACT_DATE" && temporal.targetDate) return `${koreanDate(temporal.targetDate)}에 확인되는 기록이 없어요.`;
  if (temporal.label) return `${temporal.label}에 확인되는 기록이 없어요.`;
  return "그 내용은 아직 확인되는 기록에 없어요.";
}

function attachTopicParticle(word: string): string {
  const trimmed = word.trim();
  if (!trimmed) return "그 날은";
  const lastChar = trimmed[trimmed.length - 1];
  const code = lastChar.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const hasBatchim = (code - 0xac00) % 28 !== 0;
    return `${trimmed}${hasBatchim ? "은" : "는"}`;
  }
  if (/[0-9]/.test(lastChar)) {
    const batchimDigits = ["0", "1", "3", "6", "7", "8"];
    const hasBatchim = batchimDigits.includes(lastChar);
    return `${trimmed}${hasBatchim ? "은" : "는"}`;
  }
  return `${trimmed}은`;
}

/** 기록 조회가 아니라 "그 날이 며칠인지" 자체를 묻는 질문인지 판정한다. */
export function isDateFactQuestion(text: string): boolean {
  const normalized = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  // 1. 아이의 활동/기록/상태 조회나 일반 요청은 날짜 사실 질문에서 제외
  const EXCLUDE_PATTERN = /(?:기록|리포트|보고서|내용|활동|대화|일과|일기|숙제|학교|학원|친구|서아|서현|우리\s*애|아이|딸|아들|뭐했|뭐\s*했|뭐\s*먹|어땠|좋아|놀았|갔|했어|했니|했는지|물어|취소)/;
  if (EXCLUDE_PATTERN.test(normalized)) {
    return false;
  }

  // 2. 날짜/시점 키워드와 질문/인지 여부 표현 결합 확인
  const hasDateTarget = /(?:어제|오늘|그제|그저께|내일|그날|그\s*날|그때|그\s*때|날짜|일자)/.test(normalized);
  const hasDateAsk = /(?:며칠|몇\s*일|몇일|언제)/.test(normalized);
  const hasDateKnowledge = /(?:날짜|일자).*(?:모르|몰라|알아|알고|알지|맞춰|맞혀|뭐야|뭔데|어떻게\s*돼|알려)/.test(normalized);
  const hasTargetKnowledge = /(?:어제|오늘|그제|그저께|그날|그\s*날|그때|그\s*때).*(?:날짜).*(?:모르|몰라|알아|알고|알지)/.test(normalized);

  if (hasDateTarget && hasDateAsk) return true;
  if (hasDateKnowledge || hasTargetKnowledge) return true;

  return false;
}

/** 날짜 자체 질문에 대한 답. 해석된 날짜를 밝힌다. temporal이 날짜로 확정되지 않으면 null. */
export function answerForDateFact(temporal: ParentTemporalResolution): string | null {
  if (!temporal.targetDate) return null;
  const subject = temporal.label ? attachTopicParticle(temporal.label) : "그 날은";
  return `${subject} ${koreanDate(temporal.targetDate)}이에요.`;
}


/** 요일·시간·월처럼 아이 기록과 무관한 사실 질문인지 판정한다(084 §9).
 *
 * 날짜(며칠)와 달리 요일·시간은 모델이 추측하면 틀린다 — 2026-08-16 Dev 실측에서
 * 일요일을 "수요일"로 답했다. 아이 기록 조회 질문과 구분되는 순수 사실 질문만 잡는다. */
export function isClockFactQuestion(text: string): boolean {
  const normalized = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  const EXCLUDE = /(?:기록|리포트|보고서|내용|활동|대화|일과|일기|숙제|학교|학원|친구|서아|서현|우리\s*애|아이|딸|아들|뭐했|뭐\s*했|어땠|좋아|놀았|물어)/;
  if (EXCLUDE.test(normalized)) return false;
  const asksWeekday = /(?:무슨\s*요일|요일이야|요일이에요|요일인가|몇\s*요일)/.test(normalized);
  const asksTime = /(?:몇\s*시|시간이\s*(?:어떻게|뭐)|지금\s*몇)/.test(normalized);
  const asksMonth = /(?:몇\s*월|무슨\s*달)/.test(normalized);
  return asksWeekday || asksTime || asksMonth;
}

/** 요일·시간·월 질문에 KST 기준 계산값으로 답한다. 해당 질문이 아니면 null. */
export function answerForClockFact(text: string, now: Date = new Date()): string | null {
  if (!isClockFactQuestion(text)) return null;
  const normalized = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", ...opts }).format(now);

  if (/(?:무슨\s*요일|요일이야|요일이에요|요일인가|몇\s*요일)/.test(normalized)) {
    return `오늘은 ${fmt({ weekday: "long" })}이에요.`;
  }
  if (/(?:몇\s*시|시간이\s*(?:어떻게|뭐)|지금\s*몇)/.test(normalized)) {
    return `지금은 ${fmt({ hour: "numeric", minute: "2-digit", hour12: true })}예요.`;
  }
  return `이번 달은 ${fmt({ month: "long" })}이에요.`;
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
