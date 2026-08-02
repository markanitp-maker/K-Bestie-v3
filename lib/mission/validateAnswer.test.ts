import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAnswer } from "./validateAnswer.js";

test("validateAnswer: 첫 답변 정상", () => {
  const res = validateAnswer("체육 시간에 축구한 게 제일 기억나");
  assert.equal(res.valid, true);
});

test("validateAnswer: '무슨 말이야?'", () => {
  const res = validateAnswer("무슨 말이야?");
  assert.equal(res.valid, false);
  assert.equal(res.reason, "clarification_needed");
  assert.equal(res.needsClarification, true);
});

test("validateAnswer: '다시 말해줘'", () => {
  const res = validateAnswer("다시 말해줘");
  assert.equal(res.valid, false);
  assert.equal(res.reason, "clarification_needed");
});

test("validateAnswer: '질문이 어려워'", () => {
  const res = validateAnswer("질문이 어려워");
  assert.equal(res.valid, false);
  assert.equal(res.reason, "clarification_needed");
});

test("validateAnswer: '뭐라고?'", () => {
  const res = validateAnswer("뭐라고?");
  assert.equal(res.valid, false);
  assert.equal(res.reason, "clarification_needed");
});

test("validateAnswer: '잘 못 들었어'", () => {
  const res = validateAnswer("잘 못 들었어");
  assert.equal(res.valid, false);
  assert.equal(res.reason, "clarification_needed");
});

test("validateAnswer: '잘 모르겠어'", () => {
  const res = validateAnswer("잘 모르겠어");
  assert.equal(res.valid, false);
  assert.equal(res.reason, "clarification_needed");
});

test("validateAnswer: STT가 짧게 '뭐'", () => {
  const res = validateAnswer("뭐");
  // 뭐 is length 1 (too_short) or evasive? "뭐" is length 1 meaningful char.
  assert.equal(res.valid, false);
  assert.equal(res.reason, "too_short");
});

test("validateAnswer: STT가 '몰라'", () => {
  const res = validateAnswer("몰라");
  assert.equal(res.valid, false);
  assert.equal(res.reason, "clarification_needed");
});

test("validateAnswer: '싫어' (거절)", () => {
  const res = validateAnswer("싫어");
  assert.equal(res.valid, false);
  assert.equal(res.reason, "evasive");
  assert.equal(res.refused, true);
});

// claude-review-048 지적: CLARIFICATION_PHRASES의 무제한 includes()가 "다시"/"모르겠" 같은
// 흔한 단어를 문장 중간에서도 매칭해 실제로는 유효한 답변을 오분류했다(수정 후 회귀 테스트).
test("validateAnswer: 트리거 단어가 문장 중간에 있는 유효 답변(다시)은 오분류하지 않는다", () => {
  const res = validateAnswer("이따가 다시 놀이터 갈 거야");
  assert.equal(res.valid, true);
});

test("validateAnswer: 트리거 단어가 문장 중간에 있는 유효 답변(모르겠)은 오분류하지 않는다", () => {
  const res = validateAnswer("정확힌 모르겠지만 재밌었어");
  assert.equal(res.valid, true);
});

test("validateAnswer: 트리거 단어가 문장 중간에 있는 유효 답변(이해)은 오분류하지 않는다", () => {
  const res = validateAnswer("이해심이 많은 친구가 도와줬어");
  assert.equal(res.valid, true);
});
