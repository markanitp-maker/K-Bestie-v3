import type { ParentConversationTurn } from "@/lib/parentKChat/parentKnowledgeRetrieval";
import type { ParentTemporalResolution } from "@/lib/parentKChat/temporalQuery";
import { pickAvoiding } from "@/lib/freechat/reactionEngine";

export type ParentAnswerStatus = "EVIDENCE_FOUND" | "PARTIAL_EVIDENCE" | "NO_DATA" | "SYSTEM_ERROR";

export interface ParentAskChildContext {
  proposal: string;
  requestedTopic: string;
  lastUnknownDetail: string;
  targetDate: string | null;
}

export const REPEAT_ANSWER_PREFIXES = [
  "제가 아는 건 여기까지예요. ",
  "기록에 남은 건 이게 전부예요. ",
  "지금 확인되는 내용은 여기까지예요. ",
] as const;

export function normalizeForAnswerComparison(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, "");
}

function stripRepeatPrefix(text: string): string {
  let result = text.trim();
  for (const prefix of REPEAT_ANSWER_PREFIXES) {
    if (result.startsWith(prefix.trim())) {
      result = result.slice(prefix.trim().length).trim();
    }
  }
  return result;
}

export function findLastKResponse(context: ParentConversationTurn[]): string | null {
  const turn = [...context]
    .reverse()
    .find((t) => t.role === "k" && typeof t.text === "string" && t.text.trim().length > 0);
  return turn ? turn.text.trim() : null;
}

export function applyRepeatAvoidancePrefix(
  answer: string,
  context: ParentConversationTurn[],
  rand: () => number = Math.random,
): string {
  const lastKText = findLastKResponse(context);
  if (!lastKText) return answer;

  const cleanAnswer = stripRepeatPrefix(answer);
  const cleanLast = stripRepeatPrefix(lastKText);

  const normAnswer = normalizeForAnswerComparison(cleanAnswer);
  const normLast = normalizeForAnswerComparison(cleanLast);

  if (!normAnswer || normAnswer !== normLast) {
    return answer;
  }

  const recentKPrefixes = context
    .filter((turn) => turn.role === "k")
    .map((turn) => turn.text)
    .flatMap((text) => {
      const matched = REPEAT_ANSWER_PREFIXES.find(
        (p) => text.startsWith(p.trim()) || normalizeForAnswerComparison(text).startsWith(normalizeForAnswerComparison(p)),
      );
      return matched ? [matched] : [text];
    });

  const prefix = pickAvoiding(
    [...REPEAT_ANSWER_PREFIXES],
    recentKPrefixes,
    (item) => item,
    rand,
  ) ?? REPEAT_ANSWER_PREFIXES[0];

  return `${prefix}${cleanAnswer}`;
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

/**
 * 부모가 직전 답변을 정정할 때, 무엇을 다시 조회해야 하는지 찾는다.
 *
 * `isInformationQuery` 를 반드시 넘겨라. 예전에는 인사말 몇 개만 빼고 **직전 부모
 * 발화를 아무거나** 집어왔는데, 그 결과 "너 업데이트 되니?" 같은 케이 자신에 대한
 * 질문을 아이 기록 조회로 되돌려 "2026년 8월 18일에 확인되는 기록이 없어요" 라고
 * 답하고, "2026년 8월 18일에 너 업데이트 되니?" 라는 엉뚱한 질문 초안까지 만들었다
 * (2026-08-18 Dev QA 실측). 부모는 대화가 안 통한다고 느낀다.
 *
 * 정정 복구는 **직전 발화가 실제로 아이 정보 질문일 때만** 의미가 있다.
 */
export function findPreviousParentInformationQuery(
  context: ParentConversationTurn[],
  isInformationQuery?: (text: string) => boolean,
): string | null {
  const candidate = [...context]
    .reverse()
    .find((turn) => {
      if (turn.role !== "user") return false;
      const text = turn.text.trim();
      if (/^(안녕|고마워|감사|물어\s*봐|여쭤\s*봐)/.test(text)) return false;
      // 판별자가 없으면 기존 동작을 유지한다(호출부가 점진적으로 넘긴다).
      return isInformationQuery ? isInformationQuery(text) : true;
    });
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

/**
 * 근거 기반 RAG 프롬프트에 주입할 부모-케이 대화 맥락을 조립한다.
 * 부모(`user`)와 케이(`k`) 발화를 순서대로 포함한다.
 */
export function formatConversationContextForPrompt(
  context: ParentConversationTurn[],
): string {
  if (!Array.isArray(context) || context.length === 0) return "";
  return context
    .filter((turn) => typeof turn.text === "string" && turn.text.trim().length > 0)
    .map((turn) => `${turn.role === "k" ? "케이" : "부모"}: ${turn.text.trim()}`)
    .join("\n");
}

export interface GenAIContentTurn {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

/**
 * 일반 대화 경로에서 @google/genai SDK로 전달할 멀티턴 contents 배열을 조립한다.
 * 최근 부모/케이 대화 이력을 user/model 역할로 순서대로 담고, 마지막에 이번 질문을 user 턴으로 추가한다.
 */
export function buildGeneralChatContents(
  context: ParentConversationTurn[],
  currentQuestion: string,
): GenAIContentTurn[] {
  const history: GenAIContentTurn[] = (Array.isArray(context) ? context : [])
    .filter((turn) => typeof turn.text === "string" && turn.text.trim().length > 0)
    .map((turn) => ({
      role: turn.role === "k" ? ("model" as const) : ("user" as const),
      parts: [{ text: turn.text.trim() }],
    }));
  return [...history, { role: "user" as const, parts: [{ text: currentQuestion.trim() }] }];
}

