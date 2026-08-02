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
