import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_STAGE_RULE_SET } from "./effectiveStage";
import { loadRelationshipStageRuleSet } from "./stageRuleConfig";

test("환경변수가 없거나 빈 문자열이면 DEFAULT_STAGE_RULE_SET을 반환한다", () => {
  assert.deepEqual(loadRelationshipStageRuleSet({}), DEFAULT_STAGE_RULE_SET);
  assert.deepEqual(
    loadRelationshipStageRuleSet({ RELATIONSHIP_STAGE_RULES: "" }),
    DEFAULT_STAGE_RULE_SET,
  );
  assert.deepEqual(
    loadRelationshipStageRuleSet({ RELATIONSHIP_STAGE_RULES: "   " }),
    DEFAULT_STAGE_RULE_SET,
  );
});

test("유효한 환경변수 JSON이 제공되면 해당 ruleSet으로 덮어쓴다", () => {
  const customConfig = {
    version: "v2-custom",
    thresholds: [
      {
        stage: "W2",
        minConversationCount: 3,
        minConversationDays: 3,
        minUsableMemoryCount: 2,
        minSharedMemoryCount: 1,
        minRelationshipEventCount: 1,
      },
      {
        stage: "W3",
        minConversationCount: 6,
        minConversationDays: 5,
        minUsableMemoryCount: 4,
        minSharedMemoryCount: 2,
        minRelationshipEventCount: 2,
      },
      {
        stage: "W4",
        minConversationCount: 10,
        minConversationDays: 8,
        minUsableMemoryCount: 6,
        minSharedMemoryCount: 3,
        minRelationshipEventCount: 4,
      },
    ],
  };

  const loaded = loadRelationshipStageRuleSet({
    RELATIONSHIP_STAGE_RULES: JSON.stringify(customConfig),
  });

  assert.deepEqual(loaded, customConfig);
});

test("잘못된 JSON 형식이면 기본값으로 복구(fail-safe)된다", () => {
  const loaded = loadRelationshipStageRuleSet({
    RELATIONSHIP_STAGE_RULES: "{ invalid json string",
  });
  assert.deepEqual(loaded, DEFAULT_STAGE_RULE_SET);
});

test("음수 threshold가 포함되면 전체가 기본값으로 복구된다", () => {
  const invalidConfig = {
    version: "v2-invalid",
    thresholds: [
      {
        stage: "W2",
        minConversationCount: -1, // 음수 오류
        minConversationDays: 2,
        minUsableMemoryCount: 1,
        minSharedMemoryCount: 0,
        minRelationshipEventCount: 0,
      },
      {
        stage: "W3",
        minConversationCount: 5,
        minConversationDays: 4,
        minUsableMemoryCount: 3,
        minSharedMemoryCount: 1,
        minRelationshipEventCount: 1,
      },
      {
        stage: "W4",
        minConversationCount: 9,
        minConversationDays: 7,
        minUsableMemoryCount: 5,
        minSharedMemoryCount: 2,
        minRelationshipEventCount: 3,
      },
    ],
  };

  const loaded = loadRelationshipStageRuleSet({
    RELATIONSHIP_STAGE_RULES: JSON.stringify(invalidConfig),
  });
  assert.deepEqual(loaded, DEFAULT_STAGE_RULE_SET);
});

test("소수점(부동소수점) 숫자가 포함되면 전체가 기본값으로 복구된다", () => {
  const invalidConfig = {
    version: "v2-invalid",
    thresholds: [
      {
        stage: "W2",
        minConversationCount: 2.5, // 정수가 아님
        minConversationDays: 2,
        minUsableMemoryCount: 1,
        minSharedMemoryCount: 0,
        minRelationshipEventCount: 0,
      },
      {
        stage: "W3",
        minConversationCount: 5,
        minConversationDays: 4,
        minUsableMemoryCount: 3,
        minSharedMemoryCount: 1,
        minRelationshipEventCount: 1,
      },
      {
        stage: "W4",
        minConversationCount: 9,
        minConversationDays: 7,
        minUsableMemoryCount: 5,
        minSharedMemoryCount: 2,
        minRelationshipEventCount: 3,
      },
    ],
  };

  const loaded = loadRelationshipStageRuleSet({
    RELATIONSHIP_STAGE_RULES: JSON.stringify(invalidConfig),
  });
  assert.deepEqual(loaded, DEFAULT_STAGE_RULE_SET);
});

test("알 수 없는 stage명이 포함되면 기본값으로 복구된다", () => {
  const invalidConfig = {
    version: "v2-invalid",
    thresholds: [
      {
        stage: "W5", // 유효하지 않은 stage
        minConversationCount: 2,
        minConversationDays: 2,
        minUsableMemoryCount: 1,
        minSharedMemoryCount: 0,
        minRelationshipEventCount: 0,
      },
      {
        stage: "W3",
        minConversationCount: 5,
        minConversationDays: 4,
        minUsableMemoryCount: 3,
        minSharedMemoryCount: 1,
        minRelationshipEventCount: 1,
      },
      {
        stage: "W4",
        minConversationCount: 9,
        minConversationDays: 7,
        minUsableMemoryCount: 5,
        minSharedMemoryCount: 2,
        minRelationshipEventCount: 3,
      },
    ],
  };

  const loaded = loadRelationshipStageRuleSet({
    RELATIONSHIP_STAGE_RULES: JSON.stringify(invalidConfig),
  });
  assert.deepEqual(loaded, DEFAULT_STAGE_RULE_SET);
});

test("version 또는 thresholds 누락 시 기본값으로 복구된다", () => {
  assert.deepEqual(
    loadRelationshipStageRuleSet({
      RELATIONSHIP_STAGE_RULES: JSON.stringify({ version: "" }),
    }),
    DEFAULT_STAGE_RULE_SET,
  );

  assert.deepEqual(
    loadRelationshipStageRuleSet({
      RELATIONSHIP_STAGE_RULES: JSON.stringify({ version: "v1", thresholds: [] }),
    }),
    DEFAULT_STAGE_RULE_SET,
  );

  assert.deepEqual(
    loadRelationshipStageRuleSet({
      RELATIONSHIP_STAGE_RULES: JSON.stringify({ thresholds: [] }),
    }),
    DEFAULT_STAGE_RULE_SET,
  );
});

test("중복된 stage 정의가 있으면 기본값으로 복구된다", () => {
  const duplicateStageConfig = {
    version: "v2-dup",
    thresholds: [
      {
        stage: "W2",
        minConversationCount: 2,
        minConversationDays: 2,
        minUsableMemoryCount: 1,
        minSharedMemoryCount: 0,
        minRelationshipEventCount: 0,
      },
      {
        stage: "W2", // 중복
        minConversationCount: 3,
        minConversationDays: 3,
        minUsableMemoryCount: 2,
        minSharedMemoryCount: 0,
        minRelationshipEventCount: 0,
      },
      {
        stage: "W4",
        minConversationCount: 9,
        minConversationDays: 7,
        minUsableMemoryCount: 5,
        minSharedMemoryCount: 2,
        minRelationshipEventCount: 3,
      },
    ],
  };

  const loaded = loadRelationshipStageRuleSet({
    RELATIONSHIP_STAGE_RULES: JSON.stringify(duplicateStageConfig),
  });
  assert.deepEqual(loaded, DEFAULT_STAGE_RULE_SET);
});

test("단계 하나만 지정해도 그것만 덮어쓰고 나머지는 기본값을 쓴다", () => {
  // 3단계를 전부 적어야만 통과하면 threshold 하나 조정이 불가능해
  // §7의 "운영 중 migration 없이 조정 가능"이 성립하지 않는다.
  const ruleSet = loadRelationshipStageRuleSet({
    RELATIONSHIP_STAGE_RULES: JSON.stringify({
      version: "v2",
      thresholds: [{
        stage: "W2",
        minConversationCount: 1,
        minConversationDays: 1,
        minUsableMemoryCount: 0,
        minSharedMemoryCount: 0,
        minRelationshipEventCount: 0,
      }],
    }),
  } as NodeJS.ProcessEnv);

  assert.equal(ruleSet.version, "v2");
  assert.equal(ruleSet.thresholds.length, 3, "W2/W3/W4가 모두 남아야 한다");

  const w2 = ruleSet.thresholds.find((t) => t.stage === "W2");
  assert.equal(w2?.minConversationCount, 1, "지정한 단계는 덮어써야 한다");

  const defaultW3 = DEFAULT_STAGE_RULE_SET.thresholds.find((t) => t.stage === "W3");
  const w3 = ruleSet.thresholds.find((t) => t.stage === "W3");
  assert.deepEqual(w3, defaultW3, "지정하지 않은 단계는 기본값이어야 한다");
});

test("thresholds가 비어 있으면 기본값으로 되돌린다", () => {
  const ruleSet = loadRelationshipStageRuleSet({
    RELATIONSHIP_STAGE_RULES: JSON.stringify({ version: "v2", thresholds: [] }),
  } as NodeJS.ProcessEnv);
  assert.equal(ruleSet.version, DEFAULT_STAGE_RULE_SET.version);
});
