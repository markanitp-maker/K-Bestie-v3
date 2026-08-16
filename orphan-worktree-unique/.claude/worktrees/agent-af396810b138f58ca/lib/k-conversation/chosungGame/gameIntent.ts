import type { UtteranceSignals } from "../utteranceSignals";

export type OfferedResponseIntent = "accept" | "decline";
export type ActiveGameIntent =
  | "strong_non_game"
  | "stop"
  | "reveal"
  | "hint"
  | "answer_attempt";

const START_PATTERNS = [
  /초성\s*게임.*(?:하자|해|할래|하고\s*싶)/,
  /초성\s*퀴즈.*(?:하자|해|할래|내줘|내\s*줘)/,
  /초성.*문제.*(?:내줘|내\s*줘|풀자)/,
];

const ACCEPT_PATTERNS = [
  /^(?:응|어|네|좋아|좋지|그래|하자|해보자|콜|오케이|ㅇㅇ)(?:[!~ㅋㅎ.\s]*)$/,
  /(?:좋아|재밌겠다|해\s*보자|콜|오케이)/,
];

const STOP_PATTERNS = [
  /그만\s*(?:할래|하자|해|$)/,
  /안\s*할래|안\s*해/,
  /다른\s*(?:거|것|게임|얘기|이야기)(?:\s*(?:하자|할래|해|말해))?/,
  /지금\s*말고/,
];

const REVEAL_PATTERNS = [
  /포기/,
  /정답\s*(?:알려|말해|공개)/,
  /(?:답|정답)이?\s*뭐야/,
  /모르겠(?:다|어)?\s*그만/,
  /(?:그냥\s*)?알려\s*줘/,
];

const HINT_PATTERNS = [
  /힌트/,
  /모르겠어|모르겠다|모르겠는데/,
  /어려워|어렵다|어려운데/,
  /(?:^|\s)몰라(?:[.!?~\s]|$)/,
];

const normalizeIntentText = (text: string): string =>
  text.trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");

const matchesAny = (text: string, patterns: readonly RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(text));

export const isChosungStartRequest = (text: string): boolean =>
  matchesAny(normalizeIntentText(text), START_PATTERNS);

export const isStandaloneChosung = (text: string): boolean =>
  /^[ㄱ-ㅎ]{2,6}$/.test(text.trim());

export const classifyOfferedResponse = (text: string): OfferedResponseIntent =>
  matchesAny(normalizeIntentText(text), ACCEPT_PATTERNS) ? "accept" : "decline";

export const classifyActiveGameIntent = (
  text: string,
  signals: UtteranceSignals,
): ActiveGameIntent => {
  if (
    signals.hasConflict
    || signals.hasNegativeEmotion
    || signals.hasPhysicalNeed
    || signals.hasGeneralKnowledgeQuestion
    || signals.hasMemoryRecallQuery
  ) {
    return "strong_non_game";
  }

  const normalized = normalizeIntentText(text);
  const hasTopicShift = /(?:다른|딴)\s*(?:거|것|게임|얘기|이야기)/.test(normalized);
  if (hasTopicShift) return "stop";
  if (/모르겠(?:다|어)?\s*그만/.test(normalized)) return "reveal";
  if (matchesAny(normalized, STOP_PATTERNS)) return "stop";
  if (matchesAny(normalized, REVEAL_PATTERNS)) return "reveal";
  if (matchesAny(normalized, HINT_PATTERNS)) return "hint";
  return "answer_attempt";
};
