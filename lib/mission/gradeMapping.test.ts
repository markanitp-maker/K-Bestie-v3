import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGrade, getEffectiveContentGrade } from "./selectQuestions";

// requests/request_middle_school_grade_support.md — 실제 학년(parseGrade) vs
// 콘텐츠 학년(getEffectiveContentGrade) 분리 검증

test("parseGrade — 기존 초1~6 텍스트는 회귀 없이 그대로 파싱된다", () => {
  assert.equal(parseGrade("1학년"), 1);
  assert.equal(parseGrade("2학년"), 2);
  assert.equal(parseGrade("3학년"), 3);
  assert.equal(parseGrade("4학년"), 4);
  assert.equal(parseGrade("5학년"), 5);
  assert.equal(parseGrade("6학년"), 6);
  assert.equal(parseGrade("초4"), 4);
  assert.equal(parseGrade(4), 4);
});

test("parseGrade — 중학교 1학년은 실제 학년 7로 파싱된다(단순 숫자 추출과 충돌 방지)", () => {
  assert.equal(parseGrade("중학교 1학년"), 7);
  assert.equal(parseGrade("중1"), 7);
});

test("parseGrade — null/undefined/빈 문자열은 null", () => {
  assert.equal(parseGrade(null), null);
  assert.equal(parseGrade(undefined), null);
  assert.equal(parseGrade(""), null);
});

test("getEffectiveContentGrade — 초1~6은 그대로(identity), 중학교 1학년(7)만 초6 콘텐츠로 대체", () => {
  for (let g = 1; g <= 6; g++) {
    assert.equal(getEffectiveContentGrade(g), g);
  }
  assert.equal(getEffectiveContentGrade(7), 6);
});
