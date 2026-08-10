export type RoundResult = "correct" | "skip" | "revealed" | "child_asked";

export interface RoundOutcome {
  result: RoundResult;
  hintUsed: number;
}

export interface AdaptiveDifficultyInput {
  currentDifficulty: number;
  minDifficulty: number;
  maxDifficulty: number;
  /**
   * Most recent outcome first. Only the first five outcomes are considered.
   * `child_asked` outcomes are excluded because K does not control their difficulty.
   */
  recentOutcomes: readonly RoundOutcome[];
}

const RECENT_OUTCOME_LIMIT = 5;
const MIN_HIGH_ACCURACY_SAMPLE_SIZE = 4;
const HIGH_ACCURACY_THRESHOLD = 0.8;
const CONSECUTIVE_CORRECTS_TO_INCREASE = 2;
const CONSECUTIVE_MISSES_TO_DECREASE = 2;
const REPEATED_HINTS_TO_DECREASE = 2;
const REPEATED_REVEALS_TO_DECREASE = 2;

const isKAskedOutcome = (outcome: RoundOutcome): boolean =>
  outcome.result !== "child_asked";

const countLeading = (
  outcomes: readonly RoundOutcome[],
  predicate: (outcome: RoundOutcome) => boolean,
): number => {
  let count = 0;

  for (const outcome of outcomes) {
    if (!predicate(outcome)) {
      break;
    }

    count += 1;
  }

  return count;
};

const clampDifficulty = (difficulty: number, min: number, max: number): number =>
  Math.min(Math.max(difficulty, min), max);

/**
 * Computes the next difficulty from the five most recent rounds, ordered newest first.
 * A decrease wins when positive and negative signals occur together so a child is never
 * advanced while there is a clear difficulty signal in the same recent window.
 */
export const computeNextDifficulty = ({
  currentDifficulty,
  minDifficulty,
  maxDifficulty,
  recentOutcomes,
}: AdaptiveDifficultyInput): number => {
  const outcomes = recentOutcomes
    .filter(isKAskedOutcome)
    .slice(0, RECENT_OUTCOME_LIMIT);
  const current = clampDifficulty(currentDifficulty, minDifficulty, maxDifficulty);

  if (outcomes.length === 0) {
    return current;
  }

  const consecutiveCorrects = countLeading(
    outcomes,
    (outcome) => outcome.result === "correct",
  );
  const consecutiveMisses = countLeading(
    outcomes,
    (outcome) => outcome.result === "skip" || outcome.result === "revealed",
  );
  const hintCount = outcomes.reduce((total, outcome) => total + Math.max(0, outcome.hintUsed), 0);
  const revealedCount = outcomes.filter((outcome) => outcome.result === "revealed").length;
  const correctCount = outcomes.filter((outcome) => outcome.result === "correct").length;
  const correctRate = correctCount / outcomes.length;

  const shouldDecrease = consecutiveMisses >= CONSECUTIVE_MISSES_TO_DECREASE
    || hintCount >= REPEATED_HINTS_TO_DECREASE
    || revealedCount >= REPEATED_REVEALS_TO_DECREASE;

  if (shouldDecrease) {
    return clampDifficulty(current - 1, minDifficulty, maxDifficulty);
  }

  const hasEasyCorrectStreak = consecutiveCorrects >= CONSECUTIVE_CORRECTS_TO_INCREASE
    && hintCount === 0;
  const hasHighRecentAccuracy = outcomes.length >= MIN_HIGH_ACCURACY_SAMPLE_SIZE
    && correctRate >= HIGH_ACCURACY_THRESHOLD
    && hintCount <= 1;

  if (hasEasyCorrectStreak || hasHighRecentAccuracy) {
    return clampDifficulty(current + 1, minDifficulty, maxDifficulty);
  }

  return current;
};
