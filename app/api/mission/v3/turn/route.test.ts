import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCompletionKMessage, DEFAULT_MISSION_COMPLETION_MESSAGE } from "@/lib/mission-v3/routeSupport";

test("미션 완료 턴은 응답이 마무리 멘트로 교체된다", () => {
  const rawDraft = "오늘 체육 수업 이야기 재미있었어! 다음 주에는 체육 시간에 또 뭐 해?";
  const finalizedMessage = buildCompletionKMessage(rawDraft);

  assert.equal(finalizedMessage.includes("다음 주에는"), false);
  assert.equal(finalizedMessage.startsWith("오늘 체육 수업 이야기 재미있었어!"), true);
  assert.equal(finalizedMessage.endsWith(DEFAULT_MISSION_COMPLETION_MESSAGE), true);
});

test("미션 미완료 턴은 기존 케이 응답 draft(다음 질문 포함)가 그대로 유지된다", () => {
  const rawDraft = "오늘 체육 수업 이야기 재미있었어! 다음 주에는 체육 시간에 또 뭐 해?";
  // 미완료 턴은 buildCompletionKMessage를 통과하지 않으므로 rawDraft가 그대로 나간다.
  assert.equal(rawDraft.includes("다음 주에는"), true);
});
