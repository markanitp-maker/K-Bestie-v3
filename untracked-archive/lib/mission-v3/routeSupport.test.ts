import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConversationGoal } from "./goalEngine.js";
import {
  buildCompletionKMessage,
  buildGoalProgress,
  DEFAULT_MISSION_COMPLETION_MESSAGE,
} from "./routeSupport.js";

const makeGoal = (status: ConversationGoal["status"] = "PENDING"): ConversationGoal => ({
  goalId: "g1",
  missionSessionId: "s1",
  childId: "c1",
  goalOrder: 1,
  semanticGroup: "GROUP",
  priority: "P1",
  status,
  evidenceSource: null,
  sourceTurnId: null,
  confidence: null,
  satisfiedAt: null,
  parentQuestionId: null,
});

test("buildGoalProgress는 completionThreshold를 min(5, goals.length)로 산출한다", () => {
  const goals10 = Array.from({ length: 10 }, () => makeGoal("PENDING"));
  const progress10 = buildGoalProgress(goals10);
  assert.equal(progress10.total, 10);
  assert.equal(progress10.completionThreshold, 5);

  const goals4 = Array.from({ length: 4 }, () => makeGoal("SATISFIED"));
  const progress4 = buildGoalProgress(goals4);
  assert.equal(progress4.total, 4);
  assert.equal(progress4.completionThreshold, 4);
});

test("buildCompletionKMessage는 다음 질문을 제거하고 마무리 멘트로 교체한다", () => {
  const rawResponse = "친구들이랑 운동도 하고 알차게 보냈네! 이번 방학 동안 네가 스스로 생각했을 때 가장 자랑스러운 순간은 언제야?";
  const completionMsg = buildCompletionKMessage(rawResponse);

  assert.equal(completionMsg.includes("자랑스러운 순간은 언제야"), false);
  assert.equal(completionMsg.startsWith("친구들이랑 운동도 하고 알차게 보냈네!"), true);
  assert.equal(completionMsg.endsWith(DEFAULT_MISSION_COMPLETION_MESSAGE), true);
  assert.ok(completionMsg.length <= 80);
});

test("buildCompletionKMessage는 질문만 있던 응답도 80자 이내 마무리 멘트로 반환한다", () => {
  const rawResponse = "오늘 학교 어땠어?";
  const completionMsg = buildCompletionKMessage(rawResponse);

  assert.equal(completionMsg, DEFAULT_MISSION_COMPLETION_MESSAGE);
  assert.ok(completionMsg.length <= 80);
});
