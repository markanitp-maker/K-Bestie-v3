import assert from "node:assert/strict";
import test from "node:test";
import { GRADE_ADAPTIVE_PERSONAS } from "@/lib/persona/gradeAdaptivePersona";
import {
  GRADE_STRATEGY_VERSION,
  resolveGradeStrategy,
} from "./gradeStrategy";

test("GRADE_STRATEGY_VERSION 상수가 v1으로 정의되어 있다", () => {
  assert.equal(GRADE_STRATEGY_VERSION, "v1");
});

test("초3, 3, 3학년 입력이 동일한 Grade Strategy 객체를 반환한다", () => {
  const resultFromText1 = resolveGradeStrategy("초3");
  const resultFromNumber = resolveGradeStrategy(3);
  const resultFromText2 = resolveGradeStrategy("3학년");

  assert.ok(resultFromNumber);
  assert.equal(resultFromText1, resultFromNumber);
  assert.equal(resultFromText2, resultFromNumber);
});

test("반환값이 GRADE_ADAPTIVE_PERSONAS의 해당 학년과 동일 객체다(데이터 복제 없음)", () => {
  for (let grade = 1; grade <= 6; grade += 1) {
    const strategy = resolveGradeStrategy(grade);
    const expected = GRADE_ADAPTIVE_PERSONAS[grade as 1 | 2 | 3 | 4 | 5 | 6];
    assert.equal(strategy, expected); // reference equality (===)
  }
});

test("알 수 없거나 범위 밖의 학년 값이면 null을 반환한다 (추측 금지)", () => {
  assert.equal(resolveGradeStrategy(null), null);
  assert.equal(resolveGradeStrategy(undefined), null);
  assert.equal(resolveGradeStrategy(""), null);
  assert.equal(resolveGradeStrategy("고1"), null);
  assert.equal(resolveGradeStrategy(0), null);
  assert.equal(resolveGradeStrategy(8), null);
  assert.equal(resolveGradeStrategy("유치원"), null);
});
