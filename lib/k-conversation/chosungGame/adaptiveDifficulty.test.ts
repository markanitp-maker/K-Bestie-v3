import assert from "node:assert/strict";
import { test } from "node:test";
import { computeNextDifficulty, type RoundOutcome } from "./adaptiveDifficulty";

const baseInput = (recentOutcomes: readonly RoundOutcome[]) => ({
  currentDifficulty: 3,
  minDifficulty: 1,
  maxDifficulty: 6,
  recentOutcomes,
});

test("힌트 없이 최근 두 문제를 연속 정답하면 난이도가 올라간다", () => {
  const nextDifficulty = computeNextDifficulty(baseInput([
    { result: "correct", hintUsed: 0 },
    { result: "correct", hintUsed: 0 },
    { result: "skip", hintUsed: 0 },
  ]));

  assert.equal(nextDifficulty, 4);
});

test("최근 연속 오답이면 난이도가 내려간다", () => {
  const nextDifficulty = computeNextDifficulty(baseInput([
    { result: "revealed", hintUsed: 0 },
    { result: "skip", hintUsed: 0 },
    { result: "correct", hintUsed: 0 },
  ]));

  assert.equal(nextDifficulty, 2);
});

test("최근 라운드에서 힌트를 반복 사용하면 난이도가 내려간다", () => {
  const nextDifficulty = computeNextDifficulty(baseInput([
    { result: "correct", hintUsed: 1 },
    { result: "correct", hintUsed: 1 },
  ]));

  assert.equal(nextDifficulty, 2);
});

test("상승과 하락 신호가 충분하지 않은 혼재 결과는 난이도를 유지한다", () => {
  const nextDifficulty = computeNextDifficulty(baseInput([
    { result: "correct", hintUsed: 0 },
    { result: "skip", hintUsed: 0 },
    { result: "correct", hintUsed: 0 },
  ]));

  assert.equal(nextDifficulty, 3);
});

test("상승 및 하락 신호가 있어도 학년별 난이도 경계를 넘지 않는다", () => {
  const atMaximum = computeNextDifficulty({
    ...baseInput([
      { result: "correct", hintUsed: 0 },
      { result: "correct", hintUsed: 0 },
    ]),
    currentDifficulty: 3,
    minDifficulty: 1,
    maxDifficulty: 3,
  });
  const atMinimum = computeNextDifficulty({
    ...baseInput([
      { result: "skip", hintUsed: 0 },
      { result: "revealed", hintUsed: 0 },
    ]),
    currentDifficulty: 1,
  });

  assert.equal(atMaximum, 3);
  assert.equal(atMinimum, 1);
});

test("아이가 낸 문제만 있으면 난이도 조정 신호로 사용하지 않는다", () => {
  const nextDifficulty = computeNextDifficulty(baseInput([
    { result: "child_asked", hintUsed: 3 },
    { result: "child_asked", hintUsed: 0 },
  ]));

  assert.equal(nextDifficulty, 3);
});

test("아이가 낸 문제는 최신 5개 K 출제 결과를 고를 때도 제외한다", () => {
  const nextDifficulty = computeNextDifficulty(baseInput([
    { result: "child_asked", hintUsed: 0 },
    { result: "correct", hintUsed: 0 },
    { result: "skip", hintUsed: 0 },
    { result: "correct", hintUsed: 0 },
    { result: "correct", hintUsed: 0 },
    { result: "correct", hintUsed: 0 },
  ]));

  assert.equal(nextDifficulty, 4);
});

test("연속 정답이 없어도 최근 5문제 정답률과 힌트 사용량으로 난이도가 올라간다", () => {
  const nextDifficulty = computeNextDifficulty(baseInput([
    { result: "correct", hintUsed: 0 },
    { result: "skip", hintUsed: 0 },
    { result: "correct", hintUsed: 1 },
    { result: "correct", hintUsed: 0 },
    { result: "correct", hintUsed: 0 },
  ]));

  assert.equal(nextDifficulty, 4);
});
