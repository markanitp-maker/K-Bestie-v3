import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { EvaluatedRelationshipStage } from "./stageEvaluation";
import { persistRelationshipStage } from "./persistStage";
import type { ResolvedScenarioCard } from "./scenarioCard";

function createMockScenarioCard(): ResolvedScenarioCard {
  return {
    scenarioKey: "G3_REMEMBER_V1",
    grade: 3,
    stageKey: "REMEMBER",
    version: "V1",
    stageCard: {
      stageKey: "REMEMBER",
      version: "V1",
      primaryGoal: "목표",
      secondaryGoal: "보조 목표",
      strategy: "전략",
      recommendedMemoryTypes: ["interest", "event"],
      forbiddenPatterns: [],
      responseStyle: "응답 스타일",
      expectedEvents: [],
    },
    gradeStrategy: {
      grade: 3,
      label: "초3",
      vocabularyLevel: "쉬움",
      sentenceLength: "보통",
      questionLength: "보통",
      questionFrequency: "보통",
      initiativeRatio: 0.5,
      playfulness: "중간",
      emotionalDepth: "중간",
      memoryDirectness: "간접",
    },
  };
}

interface MockDbState {
  childProfile: {
    relationship_effective_stage: string | null;
    relationship_effective_stage_rule_version?: string | null;
    relationship_stage_advanced_at?: string | null;
  } | null;
  chatSession: {
    relationship_context: Record<string, unknown> | null;
  } | null;
  profileUpdates: Array<Record<string, unknown>>;
  sessionUpdates: Array<Record<string, unknown>>;
  throwOnTable?: string;
}

function createMockPersistDb(state: MockDbState): SupabaseClient {
  return {
    from(table: string) {
      if (state.throwOnTable === table) {
        throw new Error(`DB error on table ${table}`);
      }

      let operation = "select";
      let updatePayload: Record<string, unknown> | null = null;
      const filters: Record<string, unknown> = {};

      const builder: any = {
        select() {
          operation = "select";
          return builder;
        },
        update(payload: Record<string, unknown>) {
          operation = "update";
          updatePayload = payload;
          return builder;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return builder;
        },
        maybeSingle() {
          if (table === "child_profiles") {
            return Promise.resolve({ data: state.childProfile, error: null });
          }
          if (table === "chat_sessions") {
            return Promise.resolve({ data: state.chatSession, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (value: any) => void) {
          if (operation === "update") {
            if (table === "child_profiles" && updatePayload) {
              state.profileUpdates.push(updatePayload);
              if (state.childProfile) {
                Object.assign(state.childProfile, updatePayload);
              }
            }
            if (table === "chat_sessions" && updatePayload) {
              state.sessionUpdates.push(updatePayload);
              if (state.chatSession) {
                Object.assign(state.chatSession, updatePayload);
              }
            }
            resolve({ error: null });
            return;
          }
          resolve({ data: null, error: null });
        },
      };

      return builder;
    },
  } as unknown as SupabaseClient;
}

test("effectiveStage가 기존 값보다 올라갔을 때만 child_profiles를 갱신한다", async () => {
  const state: MockDbState = {
    childProfile: {
      relationship_effective_stage: "W1",
    },
    chatSession: {
      relationship_context: null,
    },
    profileUpdates: [],
    sessionUpdates: [],
  };
  const db = createMockPersistDb(state);

  const evaluated: EvaluatedRelationshipStage = {
    calendarStage: "W2",
    effectiveStage: "W2",
    ruleVersion: "v1",
    blockedBy: null,
    scenarioCard: createMockScenarioCard(),
    metrics: {
      conversationCount: 3,
      conversationDays: 2,
      usableMemoryCount: 2,
      sharedMemoryCount: 0,
      relationshipEventCount: 0,
    },
  };

  await persistRelationshipStage({
    db,
    childId: "child-1",
    sessionId: "session-1",
    evaluated,
  });

  assert.equal(state.profileUpdates.length, 1);
  assert.equal(state.profileUpdates[0].relationship_effective_stage, "W2");
  assert.equal(state.profileUpdates[0].relationship_effective_stage_rule_version, "v1");
  assert.ok(typeof state.profileUpdates[0].relationship_stage_advanced_at === "string");
});

test("effectiveStage가 같거나 낮으면 child_profiles를 갱신하지 않는다 (§8 자동 강등 없음)", async () => {
  const state: MockDbState = {
    childProfile: {
      relationship_effective_stage: "W3",
    },
    chatSession: {
      relationship_context: null,
    },
    profileUpdates: [],
    sessionUpdates: [],
  };
  const db = createMockPersistDb(state);

  const evaluated: EvaluatedRelationshipStage = {
    calendarStage: "W3",
    effectiveStage: "W2", // 기존 W3보다 낮음
    ruleVersion: "v1",
    blockedBy: null,
    scenarioCard: createMockScenarioCard(),
    metrics: {
      conversationCount: 1,
      conversationDays: 1,
      usableMemoryCount: 0,
      sharedMemoryCount: 0,
      relationshipEventCount: 0,
    },
  };

  await persistRelationshipStage({
    db,
    childId: "child-1",
    sessionId: "session-1",
    evaluated,
  });

  // child_profiles는 갱신되지 않아야 함
  assert.equal(state.profileUpdates.length, 0);
  // 하지만 새 세션이므로 chat_sessions.relationship_context는 기록됨
  assert.equal(state.sessionUpdates.length, 1);
});

test("chat_sessions.relationship_context가 이미 있으면 덮어쓰지 않는다 (§23, §30)", async () => {
  const state: MockDbState = {
    childProfile: {
      relationship_effective_stage: "W1",
    },
    chatSession: {
      relationship_context: {
        effectiveStage: "W1",
        calendarStage: "W1",
        ruleVersion: "v1",
        scenarioKey: "G3_MEET_V1",
        scenarioVersion: "V1",
      },
    },
    profileUpdates: [],
    sessionUpdates: [],
  };
  const db = createMockPersistDb(state);

  const evaluated: EvaluatedRelationshipStage = {
    calendarStage: "W2",
    effectiveStage: "W2",
    ruleVersion: "v1",
    blockedBy: null,
    scenarioCard: createMockScenarioCard(),
    metrics: {
      conversationCount: 5,
      conversationDays: 3,
      usableMemoryCount: 2,
      sharedMemoryCount: 1,
      relationshipEventCount: 1,
    },
  };

  await persistRelationshipStage({
    db,
    childId: "child-1",
    sessionId: "session-1",
    evaluated,
  });

  // profile은 W1 -> W2로 상승했으므로 갱신
  assert.equal(state.profileUpdates.length, 1);
  // session context는 기존 값이 있으므로 덮어쓰지 않음
  assert.equal(state.sessionUpdates.length, 0);
});

test("같은 입력으로 두 번 호출해도 안전하다 (Idempotent)", async () => {
  const state: MockDbState = {
    childProfile: {
      relationship_effective_stage: "W1",
    },
    chatSession: {
      relationship_context: null,
    },
    profileUpdates: [],
    sessionUpdates: [],
  };
  const db = createMockPersistDb(state);

  const evaluated: EvaluatedRelationshipStage = {
    calendarStage: "W2",
    effectiveStage: "W2",
    ruleVersion: "v1",
    blockedBy: null,
    scenarioCard: createMockScenarioCard(),
    metrics: {
      conversationCount: 4,
      conversationDays: 2,
      usableMemoryCount: 1,
      sharedMemoryCount: 0,
      relationshipEventCount: 0,
    },
  };

  // 1회 호출
  await persistRelationshipStage({
    db,
    childId: "child-1",
    sessionId: "session-1",
    evaluated,
  });

  assert.equal(state.profileUpdates.length, 1);
  assert.equal(state.sessionUpdates.length, 1);

  // 2회 호출 (동일 파라미터)
  await persistRelationshipStage({
    db,
    childId: "child-1",
    sessionId: "session-1",
    evaluated,
  });

  // 두 번째 호출에서는 중복 갱신이 일어나지 않음
  assert.equal(state.profileUpdates.length, 1);
  assert.equal(state.sessionUpdates.length, 1);
});

test("null인 필드는 relationship_context jsonb에 포함하지 않는다", async () => {
  const state: MockDbState = {
    childProfile: {
      relationship_effective_stage: null,
    },
    chatSession: {
      relationship_context: null,
    },
    profileUpdates: [],
    sessionUpdates: [],
  };
  const db = createMockPersistDb(state);

  const evaluated: EvaluatedRelationshipStage = {
    calendarStage: "W1",
    effectiveStage: "W1",
    ruleVersion: "v1",
    blockedBy: null, // null
    scenarioCard: null, // null
    metrics: {
      conversationCount: 0,
      conversationDays: 0,
      usableMemoryCount: 0,
      sharedMemoryCount: 0,
      relationshipEventCount: 0,
    },
  };

  await persistRelationshipStage({
    db,
    childId: "child-1",
    sessionId: "session-1",
    evaluated,
  });

  assert.equal(state.sessionUpdates.length, 1);
  const writtenContext = state.sessionUpdates[0].relationship_context as Record<string, unknown>;
  assert.deepEqual(writtenContext, {
    effectiveStage: "W1",
    calendarStage: "W1",
    ruleVersion: "v1",
  });
  assert.equal("blockedBy" in writtenContext, false);
  assert.equal("scenarioKey" in writtenContext, false);
  assert.equal("scenarioVersion" in writtenContext, false);
});

test("blockedBy가 있으면 relationship_context jsonb에 포함된다", async () => {
  const state: MockDbState = {
    childProfile: {
      relationship_effective_stage: "W1",
    },
    chatSession: {
      relationship_context: null,
    },
    profileUpdates: [],
    sessionUpdates: [],
  };
  const db = createMockPersistDb(state);

  const evaluated: EvaluatedRelationshipStage = {
    calendarStage: "W3",
    effectiveStage: "W2",
    ruleVersion: "v1",
    blockedBy: "minConversationDays",
    scenarioCard: createMockScenarioCard(),
    metrics: {
      conversationCount: 5,
      conversationDays: 2,
      usableMemoryCount: 3,
      sharedMemoryCount: 1,
      relationshipEventCount: 1,
    },
  };

  await persistRelationshipStage({
    db,
    childId: "child-1",
    sessionId: "session-1",
    evaluated,
  });

  assert.equal(state.sessionUpdates.length, 1);
  const writtenContext = state.sessionUpdates[0].relationship_context as Record<string, unknown>;
  assert.deepEqual(writtenContext, {
    effectiveStage: "W2",
    calendarStage: "W3",
    ruleVersion: "v1",
    scenarioKey: "G3_REMEMBER_V1",
    scenarioVersion: "V1",
    blockedBy: "minConversationDays",
  });
});

test("DB 실패에서도 throw 하지 않는다 (Fail-safe)", async () => {
  const state: MockDbState = {
    childProfile: {
      relationship_effective_stage: "W1",
    },
    chatSession: {
      relationship_context: null,
    },
    profileUpdates: [],
    sessionUpdates: [],
    throwOnTable: "child_profiles",
  };
  const db = createMockPersistDb(state);

  const evaluated: EvaluatedRelationshipStage = {
    calendarStage: "W2",
    effectiveStage: "W2",
    ruleVersion: "v1",
    blockedBy: null,
    scenarioCard: createMockScenarioCard(),
    metrics: {
      conversationCount: 3,
      conversationDays: 2,
      usableMemoryCount: 2,
      sharedMemoryCount: 0,
      relationshipEventCount: 0,
    },
  };

  // 예외 없이 완료되어야 함
  await persistRelationshipStage({
    db,
    childId: "child-1",
    sessionId: "session-1",
    evaluated,
  });
});
