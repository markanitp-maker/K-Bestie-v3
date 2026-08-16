import assert from "node:assert/strict";
import test from "node:test";

import { calculateEffectiveStage, type StageRuleThreshold } from "./effectiveStage";

const activity = {
  conversationCount: 3,
  conversationDays: 2,
  usableMemoryCount: 2,
  sharedMemoryCount: 1,
  relationshipEventCount: 1,
};

const rules: StageRuleThreshold[] = [
  {
    stageKey: "REMEMBER",
    stageOrder: 2,
    minConversationCount: 3,
    minConversationDays: 2,
    minUsableMemoryCount: 2,
    minSharedMemoryCount: 1,
    minRelationshipEventCount: 1,
  },
  {
    stageKey: "SHARED_HISTORY",
    stageOrder: 3,
    minConversationCount: 10,
    minConversationDays: 5,
    minUsableMemoryCount: 5,
    minSharedMemoryCount: 3,
    minRelationshipEventCount: 3,
  },
];

test("W2 cap 안에서 REMEMBER 진입 조건을 충족하면 W2 단계로 진행한다", () => {
  assert.equal(calculateEffectiveStage("W2", null, activity, [...rules].reverse()), "REMEMBER");
});

test("calendar은 W2여도 REMEMBER 조건이 부족하면 MEET에 머문다", () => {
  assert.equal(
    calculateEffectiveStage("W3", null, { ...activity, usableMemoryCount: 1 }, rules),
    "MEET",
  );
});

test("기존 effective stage는 활동량이 줄어도 downgrade하지 않는다", () => {
  assert.equal(
    calculateEffectiveStage("W3", "SHARED_HISTORY", { ...activity, conversationCount: 1, conversationDays: 1, usableMemoryCount: 0 }, rules),
    "SHARED_HISTORY",
  );
});

test("threshold rule이 없으면 안전 기본값으로 calendar cap을 사용한다", () => {
  assert.equal(calculateEffectiveStage("W3", null, activity, []), "SHARED_HISTORY");
});

test("개별 stage rule이 없으면 해당 단계는 제한 없이 통과한다", () => {
  assert.equal(
    calculateEffectiveStage("W3", null, activity, [rules[0]]),
    "SHARED_HISTORY",
  );
});

test("관계 시작 전이라 calendar stage가 없으면 effective stage도 없다", () => {
  assert.equal(calculateEffectiveStage(null, null, activity, rules), null);
});
