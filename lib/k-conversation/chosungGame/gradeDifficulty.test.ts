import assert from "node:assert/strict";
import { test } from "node:test";
import { GRADE_PERSONAS, type ElementaryGrade } from "../gradePersonas";

const EXPECTED_DIFFICULTY_RANGES: Record<ElementaryGrade, readonly [number, number]> = {
  1: [1, 2],
  2: [1, 3],
  3: [2, 4],
  4: [2, 5],
  5: [3, 5],
  6: [3, 6],
};

test("학년별 초성게임 난이도는 허용 범위 안에 있다", () => {
  for (const grade of [1, 2, 3, 4, 5, 6] as const) {
    const chosungGame = GRADE_PERSONAS[grade].chosungGame;

    assert.ok(chosungGame);
    assert.ok(chosungGame.minDifficulty <= chosungGame.baseDifficulty);
    assert.ok(chosungGame.baseDifficulty <= chosungGame.maxDifficulty);
  }
});

test("학년별 초성게임 난이도 안전 범위가 설계대로 적용된다", () => {
  for (const grade of [1, 2, 3, 4, 5, 6] as const) {
    const chosungGame = GRADE_PERSONAS[grade].chosungGame;
    const [minDifficulty, maxDifficulty] = EXPECTED_DIFFICULTY_RANGES[grade];

    assert.equal(chosungGame.minDifficulty, minDifficulty);
    assert.equal(chosungGame.maxDifficulty, maxDifficulty);
  }
});
