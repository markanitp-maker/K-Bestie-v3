import { collectPlayAnswerCandidates } from "../play/answerCandidates";

/**
 * Produces a deterministic answer-comparison form.
 * Leading/trailing whitespace is removed, repeated whitespace is collapsed, then
 * whitespace is removed so harmless spacing variants compare equally. Latin letters
 * are compared case-insensitively; other characters are left unchanged.
 */
export const normalizeAnswer = (text: string): string =>
  text.trim().replace(/\s+/g, " ").replace(/\s/g, "").toLocaleLowerCase("en-US");

/**
 * Checks the canonical answer and only the explicitly supplied accepted variants.
 * It intentionally does not infer synonyms or use an LLM for answer validation.
 */
export const isCorrectAnswer = (
  userAnswer: string,
  correctAnswer: string,
  acceptedAnswers: string[] = [],
): boolean => {
  // 015 2차 — 발화 전체가 정답과 똑같을 때만 맞다고 보면 아이의 정상적인 대답이 오답이 된다.
  // 2026-08-19 Dev 실측: "도서관 이라고" 가 오답 처리되어 세션이 넘어가지 않고
  // 이미 맞힌 초성이 다시 출제됐다. 어절 단위 후보로 대조한다(부분 문자열 대조는 하지 않는다).
  const candidates = collectPlayAnswerCandidates(userAnswer, normalizeAnswer);
  const accepted = [correctAnswer, ...acceptedAnswers];

  return accepted.some((answer) => {
    const normalizedAnswer = normalizeAnswer(answer);
    return normalizedAnswer !== "" && candidates.has(normalizedAnswer);
  });
};
