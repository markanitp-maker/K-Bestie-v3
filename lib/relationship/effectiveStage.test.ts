import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_STAGE_RULE_SET,
  resolveEffectiveStage,
  type RelationshipStageMetrics,
  type RelationshipStageRuleSet,
} from "./effectiveStage";

test("calendarStage가 null이면 effectiveStage도 null이다", () => {
  const metrics: RelationshipStageMetrics = {
    conversationCount: 100,
    conversationDays: 100,
    usableMemoryCount: 100,
    sharedMemoryCount: 100,
    relationshipEventCount: 100,
  };

  const result = resolveEffectiveStage({
    calendarStage: null,
    metrics,
  });

  assert.equal(result.effectiveStage, null);
  assert.equal(result.ruleVersion, "v1");
  assert.equal(result.blockedBy, null);
});

test("지표가 모두 0이면 W1에 머문다", () => {
  const metrics: RelationshipStageMetrics = {
    conversationCount: 0,
    conversationDays: 0,
    usableMemoryCount: 0,
    sharedMemoryCount: 0,
    relationshipEventCount: 0,
  };

  // calendarStage가 W1일 때
  const resultW1 = resolveEffectiveStage({
    calendarStage: "W1",
    metrics,
  });
  assert.equal(resultW1.effectiveStage, "W1");
  assert.equal(resultW1.blockedBy, null);

  // calendarStage가 W4일 때도 지표가 0이면 W1이고 W2의 첫 조건에서 막힌다
  const resultW4 = resolveEffectiveStage({
    calendarStage: "W4",
    metrics,
  });
  assert.equal(resultW4.effectiveStage, "W1");
  assert.equal(resultW4.blockedBy, "minConversationCount");
});

test("W2 조건을 채우면 W2가 되고, W3 조건 미달이면 W2에서 멈추며 blockedBy가 채워진다", () => {
  // W2 조건: 2회, 2일, 1개 usable memory, 0 shared, 0 event
  // W3 조건: 5회, 4일, 3개 usable memory, 1 shared, 1 event
  const metricsW2PassW3Fail: RelationshipStageMetrics = {
    conversationCount: 3, // W2 통과(>=2), W3 미달(<5)
    conversationDays: 2,
    usableMemoryCount: 1,
    sharedMemoryCount: 0,
    relationshipEventCount: 0,
  };

  const result = resolveEffectiveStage({
    calendarStage: "W3",
    metrics: metricsW2PassW3Fail,
  });

  assert.equal(result.effectiveStage, "W2");
  assert.equal(result.ruleVersion, "v1");
  assert.equal(result.blockedBy, "minConversationCount");
});

test("지표 항목별 미달 시 blockedBy가 각 미달 항목을 정확히 가리킨다", () => {
  // W2 기준 (2, 2, 1, 0, 0)
  // 1) conversationCount 부족
  assert.equal(
    resolveEffectiveStage({
      calendarStage: "W2",
      metrics: {
        conversationCount: 1,
        conversationDays: 2,
        usableMemoryCount: 1,
        sharedMemoryCount: 0,
        relationshipEventCount: 0,
      },
    }).blockedBy,
    "minConversationCount",
  );

  // 2) conversationDays 부족
  assert.equal(
    resolveEffectiveStage({
      calendarStage: "W2",
      metrics: {
        conversationCount: 2,
        conversationDays: 1,
        usableMemoryCount: 1,
        sharedMemoryCount: 0,
        relationshipEventCount: 0,
      },
    }).blockedBy,
    "minConversationDays",
  );

  // 3) usableMemoryCount 부족
  assert.equal(
    resolveEffectiveStage({
      calendarStage: "W2",
      metrics: {
        conversationCount: 2,
        conversationDays: 2,
        usableMemoryCount: 0,
        sharedMemoryCount: 0,
        relationshipEventCount: 0,
      },
    }).blockedBy,
    "minUsableMemoryCount",
  );

  // W3 기준 (5, 4, 3, 1, 1)
  // 4) sharedMemoryCount 부족
  assert.equal(
    resolveEffectiveStage({
      calendarStage: "W3",
      metrics: {
        conversationCount: 5,
        conversationDays: 4,
        usableMemoryCount: 3,
        sharedMemoryCount: 0,
        relationshipEventCount: 1,
      },
    }).blockedBy,
    "minSharedMemoryCount",
  );

  // 5) relationshipEventCount 부족
  assert.equal(
    resolveEffectiveStage({
      calendarStage: "W3",
      metrics: {
        conversationCount: 5,
        conversationDays: 4,
        usableMemoryCount: 3,
        sharedMemoryCount: 1,
        relationshipEventCount: 0,
      },
    }).blockedBy,
    "minRelationshipEventCount",
  );
});

test("effectiveStage가 calendarStage를 절대 넘지 않는다 (지표가 아무리 높아도)", () => {
  const maxMetrics: RelationshipStageMetrics = {
    conversationCount: 999,
    conversationDays: 999,
    usableMemoryCount: 999,
    sharedMemoryCount: 999,
    relationshipEventCount: 999,
  };

  assert.equal(
    resolveEffectiveStage({
      calendarStage: "W1",
      metrics: maxMetrics,
    }).effectiveStage,
    "W1",
  );

  assert.equal(
    resolveEffectiveStage({
      calendarStage: "W2",
      metrics: maxMetrics,
    }).effectiveStage,
    "W2",
  );

  assert.equal(
    resolveEffectiveStage({
      calendarStage: "W3",
      metrics: maxMetrics,
    }).effectiveStage,
    "W3",
  );

  const resultW4 = resolveEffectiveStage({
    calendarStage: "W4",
    metrics: maxMetrics,
  });
  assert.equal(resultW4.effectiveStage, "W4");
  assert.equal(resultW4.blockedBy, null);
});

test("currentEffectiveStage가 더 높으면 자동 강등되지 않는다", () => {
  const zeroMetrics: RelationshipStageMetrics = {
    conversationCount: 0,
    conversationDays: 0,
    usableMemoryCount: 0,
    sharedMemoryCount: 0,
    relationshipEventCount: 0,
  };

  // 과거에 W3까지 달성한 아이가 지표가 낮아져도 calendarStage W3 내에서 W3 유지
  const result = resolveEffectiveStage({
    calendarStage: "W3",
    metrics: zeroMetrics,
    currentEffectiveStage: "W3",
  });

  assert.equal(result.effectiveStage, "W3");
});

test("currentEffectiveStage가 있어도 calendarStage 상한을 넘지 않는다", () => {
  const zeroMetrics: RelationshipStageMetrics = {
    conversationCount: 0,
    conversationDays: 0,
    usableMemoryCount: 0,
    sharedMemoryCount: 0,
    relationshipEventCount: 0,
  };

  const result = resolveEffectiveStage({
    calendarStage: "W2",
    metrics: zeroMetrics,
    currentEffectiveStage: "W4",
  });

  assert.equal(result.effectiveStage, "W2");
});

test("커스텀 ruleSet 전달 시 해당 버전과 임계값이 적용된다", () => {
  const customRuleSet: RelationshipStageRuleSet = {
    version: "v2-custom",
    thresholds: [
      {
        stage: "W2",
        minConversationCount: 1,
        minConversationDays: 1,
        minUsableMemoryCount: 0,
        minSharedMemoryCount: 0,
        minRelationshipEventCount: 0,
      },
      {
        stage: "W3",
        minConversationCount: 2,
        minConversationDays: 2,
        minUsableMemoryCount: 0,
        minSharedMemoryCount: 0,
        minRelationshipEventCount: 0,
      },
      {
        stage: "W4",
        minConversationCount: 3,
        minConversationDays: 3,
        minUsableMemoryCount: 0,
        minSharedMemoryCount: 0,
        minRelationshipEventCount: 0,
      },
    ],
  };

  const result = resolveEffectiveStage({
    calendarStage: "W4",
    metrics: {
      conversationCount: 2,
      conversationDays: 2,
      usableMemoryCount: 0,
      sharedMemoryCount: 0,
      relationshipEventCount: 0,
    },
    ruleSet: customRuleSet,
  });

  assert.equal(result.effectiveStage, "W3");
  assert.equal(result.ruleVersion, "v2-custom");
  assert.equal(result.blockedBy, "minConversationCount");
});
