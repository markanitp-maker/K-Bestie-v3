import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAnswer } from "./answer-classifier.js";

// classifyAnswer의 규칙 기반(사전 LLM) 분기만 실제 검증한다 — SAFETY_SIGNAL/NO_RESPONSE/REFUSAL은
// Gemini 호출 전에 조기 반환되므로 네트워크 모킹 없이 결정적으로 테스트 가능하다.
// CLARIFICATION_NEEDED로 이어지는 LLM 분류 분기는 실제 모델 호출이 필요해 여기서 다루지 않고
// e2e/qa-048-mission-clarification-retry.spec.ts에서 검증한다.

test("classifyAnswer: 폭력 키워드 포함 답변은 SAFETY_SIGNAL", async () => {
  const res = await classifyAnswer("오늘 학교에서 무슨 일 있었어?", "친구한테 맞았어");
  assert.equal(res.classification, "SAFETY_SIGNAL");
});

test("classifyAnswer: 빈 답변은 NO_RESPONSE", async () => {
  const res = await classifyAnswer("오늘 뭐가 제일 기억나?", "");
  assert.equal(res.classification, "NO_RESPONSE");
});

test("classifyAnswer: 공백만 있는 답변도 NO_RESPONSE", async () => {
  const res = await classifyAnswer("오늘 뭐가 제일 기억나?", "   ");
  assert.equal(res.classification, "NO_RESPONSE");
});

test("classifyAnswer: TIMEOUT 신호는 NO_RESPONSE", async () => {
  const res = await classifyAnswer("오늘 뭐가 제일 기억나?", "TIMEOUT");
  assert.equal(res.classification, "NO_RESPONSE");
});

test("classifyAnswer: 짧은 회피 키워드(몰라)는 REFUSAL", async () => {
  const res = await classifyAnswer("오늘 뭐가 제일 기억나?", "몰라");
  assert.equal(res.classification, "REFUSAL");
});

test("classifyAnswer: 짧은 회피 키워드(패스)는 REFUSAL", async () => {
  const res = await classifyAnswer("오늘 뭐가 제일 기억나?", "패스");
  assert.equal(res.classification, "REFUSAL");
});

test("classifyAnswer: '없어'는 예외적으로 VALID", async () => {
  const res = await classifyAnswer("오늘 속상한 일 있었어?", "없어");
  assert.equal(res.classification, "VALID");
});

// clarification_counts 증가/차단 로직(app/api/mission/answer/route.ts, answer-lean/route.ts에서
// 재사용하는 것과 동일한 패턴)을 라우트 의존성 없이 순수 로직으로 검증한다.
function applyClarificationGate(
  counts: Record<string, number>,
  questionId: string,
): { counts: Record<string, number>; blocked: boolean } {
  const currentCount = counts[questionId] || 0;
  if (currentCount >= 1) {
    return { counts, blocked: true };
  }
  const next = { ...counts, [questionId]: 1 };
  return { counts: next, blocked: false };
}

test("clarification gate: 첫 실패는 재질문 허용(blocked=false), count 1로 증가", () => {
  const result = applyClarificationGate({}, "q1");
  assert.equal(result.blocked, false);
  assert.equal(result.counts.q1, 1);
});

test("clarification gate: 재질문 후 재실패는 차단(blocked=true)", () => {
  const result = applyClarificationGate({ q1: 1 }, "q1");
  assert.equal(result.blocked, true);
});

test("clarification gate: 다른 질문의 count는 서로 영향을 주지 않는다", () => {
  const result = applyClarificationGate({ q1: 1 }, "q2");
  assert.equal(result.blocked, false);
  assert.equal(result.counts.q1, 1);
  assert.equal(result.counts.q2, 1);
});
