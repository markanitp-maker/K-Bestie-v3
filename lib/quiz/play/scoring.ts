import type { QuizOptionOrder, QuizSubmittedAnswers } from "./types";

// 퀴즈마스터 프로젝트에서 포팅 — 채점 로직(문항당 10점, 총 100점, 부분점수 없음).

export const POINTS_PER_QUESTION = 10;

export interface ScoreAttemptInput {
  selectedQuestions: string[];
  submittedAnswers: QuizSubmittedAnswers;
  optionOrder: QuizOptionOrder;
  correctByQuestionId: Record<string, number>;
}

export interface ScoreAttemptResult {
  correctCount: number;
  score: number;
}

export function scoreAttempt({
  selectedQuestions,
  submittedAnswers,
  optionOrder,
  correctByQuestionId,
}: ScoreAttemptInput): ScoreAttemptResult {
  let correctCount = 0;

  for (const questionId of selectedQuestions) {
    const slot = submittedAnswers[questionId];
    if (typeof slot !== "number" || !Number.isInteger(slot)) continue;

    const permutation = optionOrder[questionId];
    if (!Array.isArray(permutation)) continue;

    const chosenOriginalIndex = permutation[slot];
    if (typeof chosenOriginalIndex !== "number") continue;

    if (chosenOriginalIndex === correctByQuestionId[questionId]) {
      correctCount += 1;
    }
  }

  return { correctCount, score: correctCount * POINTS_PER_QUESTION };
}
