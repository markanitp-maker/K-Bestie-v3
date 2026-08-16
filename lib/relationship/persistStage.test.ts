import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { EvaluatedRelationshipStage } from "./stageEvaluation";
import {
  buildRelationshipContextPayload,
  persistRelationshipStage,
  type RelationshipContextSnapshot,
} from "./persistStage";
import {
  type RelationshipStageKey,
  type ResolvedScenarioCard,
  RELATIONSHIP_STAGE_CARDS,
} from "./scenarioCard";
import { resolveGradeStrategy } from "./gradeStrategy";

function createMockScenarioCard(
  grade: number = 3,
  stageKey: RelationshipStageKey = "REMEMBER",
): ResolvedScenarioCard {
  const stageCard = RELATIONSHIP_STAGE_CARDS[stageKey];
  const gradeStrategy = resolveGradeStrategy(grade)!;
  return {
    scenarioKey: `G${grade}_${stageKey}_${stageCard.version}`,
    grade,
    stageKey,
    version: stageCard.version,
    stageCard,
    gradeStrategy,
  };
}

/**
 * PostgreSQL DB CHECK 제약(`chat_sessions_relationship_context_check`)을 1:1로 시뮬레이션한다.
 */
function validateDbConstraint(context: unknown): boolean {
  if (context === null || context === undefined) return true;
  if (typeof context !== "object" || Array.isArray(context)) return false;

  const obj = context as Record<string, unknown>;
  const requiredKeys = [
    "schema_version",
    "calendar_stage",
    "calendar_stage_source",
    "effective_stage",
    "stage_rule_version",
    "scenario_id",
    "scenario_version",
    "grade",
    "grade_strategy_version",
    "memory_refs",
    "entry_source",
    "frozen_at",
  ];

  // 12개 키가 전부 존재해야 함
  for (const key of requiredKeys) {
    if (!(key in obj)) return false;
  }

  // schema_version = 1
  if (String(obj.schema_version) !== "1") return false;

  // calendar_stage in W1..W4
  if (!["W1", "W2", "W3", "W4"].includes(String(obj.calendar_stage))) return false;

  // calendar_stage_source
  if (!["relationship_started_at", "provisional_null", "provisional_fallback"].includes(String(obj.calendar_stage_source))) {
    return false;
  }

  // effective_stage in W1..W4
  if (!["W1", "W2", "W3", "W4"].includes(String(obj.effective_stage))) return false;

  // effective_stage <= calendar_stage (배열 인덱스 순서)
  const stages = ["W1", "W2", "W3", "W4"];
  const effPos = stages.indexOf(String(obj.effective_stage));
  const calPos = stages.indexOf(String(obj.calendar_stage));
  if (effPos > calPos) return false;

  // grade: number, 1~6
  if (typeof obj.grade !== "number") return false;
  if (!["1", "2", "3", "4", "5", "6"].includes(String(obj.grade))) return false;

  // stage_rule_version: non-empty string
  if (typeof obj.stage_rule_version !== "string" || obj.stage_rule_version.length === 0) return false;

  // scenario_id: G<grade>_<STAGE> (버전 접미사 없음)
  if (typeof obj.scenario_id !== "string" || obj.scenario_id.length === 0) return false;
  const stageName =
    obj.effective_stage === "W1"
      ? "MEET"
      : obj.effective_stage === "W2"
      ? "REMEMBER"
      : obj.effective_stage === "W3"
      ? "SHARED_HISTORY"
      : obj.effective_stage === "W4"
      ? "VOLUNTARY_RETURN"
      : "";
  const expectedScenarioId = `G${obj.grade}_${stageName}`;
  if (obj.scenario_id !== expectedScenarioId) return false;

  // scenario_version: non-empty string, matches ^v[1-9][0-9]*$ (소문자 v)
  if (typeof obj.scenario_version !== "string" || obj.scenario_version.length === 0) return false;
  if (!/^v[1-9][0-9]*$/.test(obj.scenario_version)) return false;

  // grade_strategy_version: non-empty string
  if (typeof obj.grade_strategy_version !== "string" || obj.grade_strategy_version.length === 0) return false;

  // frozen_at: non-empty string
  if (typeof obj.frozen_at !== "string" || obj.frozen_at.length === 0) return false;

  // memory_refs: json array
  if (!Array.isArray(obj.memory_refs)) return false;

  // entry_source
  if (!["direct_open", "notification", "reward", "play", "parent_trigger", "unknown"].includes(String(obj.entry_source))) {
    return false;
  }

  // provisional 두 경우: calendar_stage=W1 and effective_stage=W1
  if (obj.calendar_stage_source !== "relationship_started_at") {
    if (obj.calendar_stage !== "W1" || obj.effective_stage !== "W1") {
      return false;
    }
  }

  return true;
}

interface MockDbState {
  childProfile: {
    relationship_effective_stage: string | null;
    relationship_effective_stage_rule_version?: string | null;
    relationship_stage_advanced_at?: string | null;
    relationship_started_at?: string | null;
    relationship_started_at_is_fallback?: boolean | null;
    grade?: number | string | null;
  } | null;
  chatSession: {
    relationship_context: Record<string, unknown> | null;
  } | null;
  profileUpdates: Array<Record<string, unknown>>;
  sessionUpdates: Array<Record<string, unknown>>;
  throwOnTable?: string;
  updateError?: { code: string; message: string; details?: string } | null;
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
            if (state.updateError) {
              resolve({ error: state.updateError });
              return;
            }
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

// -----------------------------------------------------------------------------
// Unit Tests: buildRelationshipContextPayload (계약 및 DB 제약 검증)
// -----------------------------------------------------------------------------

test("buildRelationshipContextPayload — 12개 키가 전부 있고 snake_case다", () => {
  const evaluated: EvaluatedRelationshipStage = {
    calendarStage: "W2",
    effectiveStage: "W2",
    ruleVersion: "v1",
    blockedBy: null,
    scenarioCard: createMockScenarioCard(3, "REMEMBER"),
    metrics: {
      conversationCount: 3,
      conversationDays: 2,
      usableMemoryCount: 2,
      sharedMemoryCount: 0,
      relationshipEventCount: 0,
    },
  };

  const payload = buildRelationshipContextPayload({
    evaluated,
    profile: {
      relationship_started_at: "2026-08-01T00:00:00Z",
      relationship_started_at_is_fallback: false,
      grade: 3,
    },
    frozenAt: "2026-08-16T12:00:00.000Z",
  });

  assert.ok(payload);
  const expectedKeys = [
    "schema_version",
    "calendar_stage",
    "calendar_stage_source",
    "effective_stage",
    "stage_rule_version",
    "scenario_id",
    "scenario_version",
    "grade",
    "grade_strategy_version",
    "memory_refs",
    "entry_source",
    "frozen_at",
  ];

  const actualKeys = Object.keys(payload);
  assert.equal(actualKeys.length, 12);
  for (const k of expectedKeys) {
    assert.ok(actualKeys.includes(k), `Key '${k}' must be present in payload`);
  }

  // DB CHECK constraint simulation
  assert.equal(validateDbConstraint(payload), true);
});

test("buildRelationshipContextPayload — scenario_id에 버전 접미사가 없다 (G3_REMEMBER 형식)", () => {
  const evaluated: EvaluatedRelationshipStage = {
    calendarStage: "W2",
    effectiveStage: "W2",
    ruleVersion: "v1",
    blockedBy: null,
    scenarioCard: createMockScenarioCard(3, "REMEMBER"),
    metrics: {
      conversationCount: 3,
      conversationDays: 2,
      usableMemoryCount: 2,
      sharedMemoryCount: 0,
      relationshipEventCount: 0,
    },
  };

  const payload = buildRelationshipContextPayload({
    evaluated,
    profile: {
      relationship_started_at: "2026-08-01T00:00:00Z",
      relationship_started_at_is_fallback: false,
      grade: 3,
    },
  });

  assert.ok(payload);
  assert.equal(payload.scenario_id, "G3_REMEMBER");
  assert.equal(payload.scenario_id.includes("_V1"), false);
  assert.equal(payload.scenario_id.includes("_v1"), false);
});

test("buildRelationshipContextPayload — scenario_version이 ^v[1-9][0-9]*$를 만족한다 (소문자 v1)", () => {
  const evaluated: EvaluatedRelationshipStage = {
    calendarStage: "W1",
    effectiveStage: "W1",
    ruleVersion: "v1",
    blockedBy: null,
    scenarioCard: createMockScenarioCard(2, "MEET"),
    metrics: {
      conversationCount: 0,
      conversationDays: 0,
      usableMemoryCount: 0,
      sharedMemoryCount: 0,
      relationshipEventCount: 0,
    },
  };

  const payload = buildRelationshipContextPayload({
    evaluated,
    profile: {
      relationship_started_at: "2026-08-16T00:00:00Z",
      relationship_started_at_is_fallback: false,
      grade: 2,
    },
  });

  assert.ok(payload);
  assert.equal(payload.scenario_version, "v1");
  assert.match(payload.scenario_version, /^v[1-9][0-9]*$/);
  assert.notEqual(payload.scenario_version, "V1");
});

test("buildRelationshipContextPayload — grade가 문자열이 아니라 숫자 1~6이다", () => {
  const evaluated: EvaluatedRelationshipStage = {
    calendarStage: "W3",
    effectiveStage: "W3",
    ruleVersion: "v1",
    blockedBy: null,
    scenarioCard: createMockScenarioCard(5, "SHARED_HISTORY"),
    metrics: {
      conversationCount: 5,
      conversationDays: 4,
      usableMemoryCount: 3,
      sharedMemoryCount: 1,
      relationshipEventCount: 1,
    },
  };

  const payload = buildRelationshipContextPayload({
    evaluated,
    profile: {
      relationship_started_at: "2026-08-01T00:00:00Z",
      relationship_started_at_is_fallback: false,
      grade: "5학년", // 문자열 입력이어도 숫자로 변환
    },
  });

  assert.ok(payload);
  assert.equal(typeof payload.grade, "number");
  assert.equal(payload.grade, 5);
  assert.equal(validateDbConstraint(payload), true);
});

test("buildRelationshipContextPayload — calendar_stage_source가 provisional일 때 두 stage가 모두 W1로 강제된다", () => {
  // 1. provisional_null 케이스 (relationship_started_at = null)
  const evaluatedNull: EvaluatedRelationshipStage = {
    calendarStage: null,
    effectiveStage: null,
    ruleVersion: "v1",
    blockedBy: null,
    scenarioCard: null,
    metrics: {
      conversationCount: 0,
      conversationDays: 0,
      usableMemoryCount: 0,
      sharedMemoryCount: 0,
      relationshipEventCount: 0,
    },
  };

  const payloadNull = buildRelationshipContextPayload({
    evaluated: evaluatedNull,
    profile: {
      relationship_started_at: null,
      relationship_started_at_is_fallback: false,
      grade: 3,
    },
  });

  assert.ok(payloadNull);
  assert.equal(payloadNull.calendar_stage_source, "provisional_null");
  assert.equal(payloadNull.calendar_stage, "W1");
  assert.equal(payloadNull.effective_stage, "W1");
  assert.equal(payloadNull.scenario_id, "G3_MEET");
  assert.equal(validateDbConstraint(payloadNull), true);

  // 2. provisional_fallback 케이스 (relationship_started_at_is_fallback = true)
  const evaluatedFallback: EvaluatedRelationshipStage = {
    calendarStage: "W3",
    effectiveStage: "W3",
    ruleVersion: "v1",
    blockedBy: null,
    scenarioCard: createMockScenarioCard(3, "SHARED_HISTORY"),
    metrics: {
      conversationCount: 5,
      conversationDays: 3,
      usableMemoryCount: 2,
      sharedMemoryCount: 0,
      relationshipEventCount: 0,
    },
  };

  const payloadFallback = buildRelationshipContextPayload({
    evaluated: evaluatedFallback,
    profile: {
      relationship_started_at: "2026-08-01T00:00:00Z",
      relationship_started_at_is_fallback: true,
      grade: 3,
    },
  });

  assert.ok(payloadFallback);
  assert.equal(payloadFallback.calendar_stage_source, "provisional_fallback");
  assert.equal(payloadFallback.calendar_stage, "W1");
  assert.equal(payloadFallback.effective_stage, "W1");
  assert.equal(payloadFallback.scenario_id, "G3_MEET");
  assert.equal(validateDbConstraint(payloadFallback), true);
});

test("buildRelationshipContextPayload — effective_stage가 calendar_stage를 넘으면 저장을 시도하지 않는다 (null 반환)", () => {
  const evaluated: EvaluatedRelationshipStage = {
    calendarStage: "W1",
    effectiveStage: "W3", // W3 > W1 위반
    ruleVersion: "v1",
    blockedBy: null,
    scenarioCard: createMockScenarioCard(3, "SHARED_HISTORY"),
    metrics: {
      conversationCount: 3,
      conversationDays: 2,
      usableMemoryCount: 2,
      sharedMemoryCount: 0,
      relationshipEventCount: 0,
    },
  };

  const payload = buildRelationshipContextPayload({
    evaluated,
    profile: {
      relationship_started_at: "2026-08-16T00:00:00Z",
      relationship_started_at_is_fallback: false,
      grade: 3,
    },
  });

  assert.equal(payload, null);
});

test("buildRelationshipContextPayload — 필수 값(grade 불명 등)이 없으면 null을 반환한다", () => {
  const evaluated: EvaluatedRelationshipStage = {
    calendarStage: "W1",
    effectiveStage: "W1",
    ruleVersion: "v1",
    blockedBy: null,
    scenarioCard: null,
    metrics: {
      conversationCount: 0,
      conversationDays: 0,
      usableMemoryCount: 0,
      sharedMemoryCount: 0,
      relationshipEventCount: 0,
    },
  };

  // grade가 null인 경우
  const payloadNoGrade = buildRelationshipContextPayload({
    evaluated,
    profile: {
      relationship_started_at: "2026-08-16T00:00:00Z",
      relationship_started_at_is_fallback: false,
      grade: null,
    },
  });
  assert.equal(payloadNoGrade, null);

  // grade가 범위 밖인 경우
  const payloadInvalidGrade = buildRelationshipContextPayload({
    evaluated,
    profile: {
      relationship_started_at: "2026-08-16T00:00:00Z",
      relationship_started_at_is_fallback: false,
      grade: "유치원",
    },
  });
  assert.equal(payloadInvalidGrade, null);
});

// -----------------------------------------------------------------------------
// Integration Tests: persistRelationshipStage
// -----------------------------------------------------------------------------

test("effectiveStage가 기존 값보다 올라갔을 때만 child_profiles를 갱신한다", async () => {
  const state: MockDbState = {
    childProfile: {
      relationship_effective_stage: "W1",
      relationship_started_at: "2026-08-01T00:00:00Z",
      relationship_started_at_is_fallback: false,
      grade: 3,
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
    scenarioCard: createMockScenarioCard(3, "REMEMBER"),
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

  // chat_sessions.relationship_context가 12개 필드 snake_case로 저장됨
  assert.equal(state.sessionUpdates.length, 1);
  const written = state.sessionUpdates[0].relationship_context;
  assert.equal(validateDbConstraint(written), true);
});

test("effectiveStage가 같거나 낮으면 child_profiles를 갱신하지 않는다 (§8 자동 강등 없음)", async () => {
  const state: MockDbState = {
    childProfile: {
      relationship_effective_stage: "W3",
      relationship_started_at: "2026-08-01T00:00:00Z",
      relationship_started_at_is_fallback: false,
      grade: 3,
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
    scenarioCard: createMockScenarioCard(3, "REMEMBER"),
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
  assert.equal(validateDbConstraint(state.sessionUpdates[0].relationship_context), true);
});

test("chat_sessions.relationship_context가 이미 있으면 덮어쓰지 않는다 (§23, §30)", async () => {
  const existingSnapshot: RelationshipContextSnapshot = {
    schema_version: 1,
    calendar_stage: "W1",
    calendar_stage_source: "relationship_started_at",
    effective_stage: "W1",
    stage_rule_version: "v1",
    scenario_id: "G3_MEET",
    scenario_version: "v1",
    grade: 3,
    grade_strategy_version: "v1",
    memory_refs: [],
    entry_source: "unknown",
    frozen_at: "2026-08-01T00:00:00.000Z",
  };

  const state: MockDbState = {
    childProfile: {
      relationship_effective_stage: "W1",
      relationship_started_at: "2026-08-01T00:00:00Z",
      relationship_started_at_is_fallback: false,
      grade: 3,
    },
    chatSession: {
      relationship_context: existingSnapshot,
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
    scenarioCard: createMockScenarioCard(3, "REMEMBER"),
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
      relationship_started_at: "2026-08-01T00:00:00Z",
      relationship_started_at_is_fallback: false,
      grade: 3,
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
    scenarioCard: createMockScenarioCard(3, "REMEMBER"),
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

test("DB 실패 및 write-once(22000)에서도 throw 하지 않는다 (Fail-safe)", async () => {
  // 1. throw 발생 시
  const stateThrow: MockDbState = {
    childProfile: {
      relationship_effective_stage: "W1",
      relationship_started_at: "2026-08-01T00:00:00Z",
      relationship_started_at_is_fallback: false,
      grade: 3,
    },
    chatSession: {
      relationship_context: null,
    },
    profileUpdates: [],
    sessionUpdates: [],
    throwOnTable: "child_profiles",
  };
  const dbThrow = createMockPersistDb(stateThrow);

  const evaluated: EvaluatedRelationshipStage = {
    calendarStage: "W2",
    effectiveStage: "W2",
    ruleVersion: "v1",
    blockedBy: null,
    scenarioCard: createMockScenarioCard(3, "REMEMBER"),
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
    db: dbThrow,
    childId: "child-1",
    sessionId: "session-1",
    evaluated,
  });

  // 2. write-once (22000) 에러 반환 시
  const stateWriteOnce: MockDbState = {
    childProfile: {
      relationship_effective_stage: "W1",
      relationship_started_at: "2026-08-01T00:00:00Z",
      relationship_started_at_is_fallback: false,
      grade: 3,
    },
    chatSession: {
      relationship_context: null,
    },
    profileUpdates: [],
    sessionUpdates: [],
    updateError: { code: "22000", message: "relationship_context_is_write_once" },
  };
  const dbWriteOnce = createMockPersistDb(stateWriteOnce);

  await persistRelationshipStage({
    db: dbWriteOnce,
    childId: "child-1",
    sessionId: "session-1",
    evaluated,
  });
});
