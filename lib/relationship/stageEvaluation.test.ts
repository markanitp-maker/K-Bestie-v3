import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  evaluateRelationshipStage,
  loadRelationshipStageMetrics,
} from "./stageEvaluation";
import { persistRelationshipStage } from "./persistStage";

function createMockDb(options: {
  childProfile?: {
    relationship_started_at?: string | Date | null;
    relationship_effective_stage?: string | null;
    grade?: string | number | null;
  } | null;
  profileError?: Error | null;
  chatSessionsCount?: number;
  chatSessionsDates?: string[];
  usableMemoryCount?: number;
  sharedMemoryCount?: number;
  relationshipEventsCount?: number;
  throwOnTable?: string;
}): SupabaseClient {
  const {
    childProfile = {
      relationship_started_at: "2026-08-01T00:00:00Z",
      relationship_effective_stage: null,
      grade: 3,
    },
    profileError = null,
    chatSessionsCount = 0,
    chatSessionsDates = [],
    usableMemoryCount = 0,
    sharedMemoryCount = 0,
    relationshipEventsCount = 0,
    throwOnTable,
  } = options;

  return {
    from(table: string) {
      if (throwOnTable === table) {
        throw new Error(`Database error on table: ${table}`);
      }

      let selectedFields = "*";
      let countOption: { count?: string; head?: boolean } | undefined;
      const filters: Record<string, unknown> = {};
      const gteFilters: Record<string, unknown> = {};

      const builder: any = {
        select(fields: string, opts?: { count?: string; head?: boolean }) {
          selectedFields = fields;
          countOption = opts;
          return builder;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return builder;
        },
        gte(col: string, val: unknown) {
          gteFilters[col] = val;
          return builder;
        },
        maybeSingle() {
          if (table === "child_profiles") {
            if (profileError) {
              return Promise.resolve({ data: null, error: profileError });
            }
            return Promise.resolve({ data: childProfile, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (value: any) => void) {
          if (table === "chat_sessions") {
            if (countOption?.head) {
              resolve({ count: chatSessionsCount, data: null, error: null });
            } else {
              const rows = chatSessionsDates.map((d) => ({ business_date: d }));
              resolve({ data: rows, error: null });
            }
            return;
          }

          if (table === "memory_facts") {
            if (gteFilters["source_count"] !== undefined) {
              resolve({ count: sharedMemoryCount, data: null, error: null });
            } else {
              resolve({ count: usableMemoryCount, data: null, error: null });
            }
            return;
          }

          if (table === "behavior_events") {
            resolve({ count: relationshipEventsCount, data: null, error: null });
            return;
          }

          resolve({ data: null, error: null });
        },
      };

      return builder;
    },
  } as unknown as SupabaseClient;
}

test("relationship_started_at이 없으면 전부 null을 반환한다", async () => {
  const db = createMockDb({
    childProfile: {
      relationship_started_at: null,
      relationship_effective_stage: null,
      grade: 3,
    },
  });

  const result = await evaluateRelationshipStage({
    db,
    childId: "child-1",
    asOf: new Date("2026-08-16T00:00:00Z"),
  });

  assert.equal(result.calendarStage, null);
  assert.equal(result.effectiveStage, null);
  assert.equal(result.scenarioCard, null);
  assert.equal(result.blockedBy, null);
  assert.equal(result.ruleVersion, "v1");
  assert.deepEqual(result.metrics, {
    conversationCount: 0,
    conversationDays: 0,
    usableMemoryCount: 0,
    sharedMemoryCount: 0,
    relationshipEventCount: 0,
  });
});

test("지표가 0이면 시작 단계 W1으로 판정된다", async () => {
  const db = createMockDb({
    childProfile: {
      relationship_started_at: "2026-08-16T00:00:00Z",
      relationship_effective_stage: null,
      grade: 3,
    },
    chatSessionsCount: 0,
    chatSessionsDates: [],
    usableMemoryCount: 0,
    sharedMemoryCount: 0,
    relationshipEventsCount: 0,
  });

  const result = await evaluateRelationshipStage({
    db,
    childId: "child-1",
    asOf: new Date("2026-08-16T12:00:00Z"),
  });

  assert.equal(result.calendarStage, "W1");
  assert.equal(result.effectiveStage, "W1");
  assert.equal(result.ruleVersion, "v1");
  assert.notEqual(result.scenarioCard, null);
  assert.equal(result.scenarioCard?.scenarioKey, "G3_MEET_V1");
  assert.equal(result.scenarioCard?.stageKey, "MEET");
  assert.deepEqual(result.metrics, {
    conversationCount: 0,
    conversationDays: 0,
    usableMemoryCount: 0,
    sharedMemoryCount: 0,
    relationshipEventCount: 0,
  });
});

test("DB 조회에서 throw가 발생해도 예외가 새어나가지 않고 null 결과를 반환한다", async () => {
  const db = createMockDb({
    throwOnTable: "child_profiles",
  });

  const result = await evaluateRelationshipStage({
    db,
    childId: "child-1",
    asOf: new Date("2026-08-16T00:00:00Z"),
  });

  assert.equal(result.calendarStage, null);
  assert.equal(result.effectiveStage, null);
  assert.equal(result.scenarioCard, null);
  assert.equal(result.blockedBy, null);
  assert.equal(result.ruleVersion, "v1");
  assert.deepEqual(result.metrics, {
    conversationCount: 0,
    conversationDays: 0,
    usableMemoryCount: 0,
    sharedMemoryCount: 0,
    relationshipEventCount: 0,
  });
});

test("currentEffectiveStage가 더 높으면 자동 강등되지 않는다 (§8)", async () => {
  // 시작일로부터 14일 경과 (W3 가능), 지표는 0이지만 기존 effective_stage가 W2인 경우
  const db = createMockDb({
    childProfile: {
      relationship_started_at: "2026-08-01T00:00:00Z",
      relationship_effective_stage: "W2",
      grade: 4,
    },
    chatSessionsCount: 0,
    chatSessionsDates: [],
    usableMemoryCount: 0,
    sharedMemoryCount: 0,
    relationshipEventsCount: 0,
  });

  const result = await evaluateRelationshipStage({
    db,
    childId: "child-1",
    asOf: new Date("2026-08-16T00:00:00Z"), // 15일 경과 -> W3
  });

  assert.equal(result.calendarStage, "W3");
  assert.equal(result.effectiveStage, "W2"); // 강등 없이 W2 유지
  assert.notEqual(result.scenarioCard, null);
  assert.equal(result.scenarioCard?.scenarioKey, "G4_REMEMBER_V1");
});

test("loadRelationshipStageMetrics는 5개 지표를 정확히 집계한다", async () => {
  const db = createMockDb({
    chatSessionsCount: 12,
    chatSessionsDates: ["2026-08-10", "2026-08-11", "2026-08-11", "2026-08-12"], // distinct 3일
    usableMemoryCount: 6,
    sharedMemoryCount: 2,
    relationshipEventsCount: 4,
  });

  const metrics = await loadRelationshipStageMetrics(db, "child-1");

  assert.deepEqual(metrics, {
    conversationCount: 12,
    conversationDays: 3,
    usableMemoryCount: 6,
    sharedMemoryCount: 2,
    relationshipEventCount: 4,
  });
});

test("loadRelationshipStageMetrics는 DB 오류 시 0으로 안전하게 fallback한다", async () => {
  const db = createMockDb({
    throwOnTable: "chat_sessions",
  });

  const metrics = await loadRelationshipStageMetrics(db, "child-1");

  assert.deepEqual(metrics, {
    conversationCount: 0,
    conversationDays: 0,
    usableMemoryCount: 0,
    sharedMemoryCount: 0,
    relationshipEventCount: 0,
  });
});

test("세션 시작 경로 배선 계약: evaluateRelationshipStage -> persistRelationshipStage 연쇄 호출이 안전하게 완료된다", async () => {
  const updates: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      const builder: any = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        gte() {
          return builder;
        },
        update(payload: Record<string, unknown>) {
          updates.push(payload);
          return builder;
        },
        maybeSingle() {
          if (table === "child_profiles") {
            return Promise.resolve({
              data: {
                relationship_started_at: "2026-08-01T00:00:00Z",
                relationship_effective_stage: null,
                grade: 3,
              },
              error: null,
            });
          }
          if (table === "chat_sessions") {
            return Promise.resolve({
              data: {
                relationship_context: null,
              },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (val: any) => void) {
          if (table === "chat_sessions") {
            resolve({ count: 1, data: [{ business_date: "2026-08-02" }], error: null });
            return;
          }
          if (table === "memory_facts") {
            resolve({ count: 1, data: null, error: null });
            return;
          }
          if (table === "behavior_events") {
            resolve({ count: 1, data: null, error: null });
            return;
          }
          resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;

  let failed = false;
  try {
    const evaluated = await evaluateRelationshipStage({
      db,
      childId: "child-1",
      asOf: new Date("2026-08-16T00:00:00Z"),
    });
    await persistRelationshipStage({
      db,
      childId: "child-1",
      sessionId: "session-1",
      evaluated,
    });
  } catch {
    failed = true;
  }

  assert.equal(failed, false);
  assert.equal(updates.length > 0, true);
});

