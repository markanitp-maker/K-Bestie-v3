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
  const normalizedUserAnswer = normalizeAnswer(userAnswer);
  const accepted = [correctAnswer, ...acceptedAnswers];

  return accepted.some((answer) => normalizedUserAnswer === normalizeAnswer(answer));
};
