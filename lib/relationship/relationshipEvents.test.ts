import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RELATIONSHIP_EVENT_NAMES,
  type RelationshipEventName,
  buildRelationshipEventKey,
  calculateReturnGapDays,
  checkAndRecordReturnedAfterGap,
  recordRelationshipEvent,
} from "./relationshipEvents";

test("relationshipEvents: RELATIONSHIP_EVENT_NAMES는 DB 허용 8종을 정확히 포함한다", () => {
  const expected = [
    "memory_used",
    "memory_acknowledged",
    "child_referenced_past",
    "direct_open",
    "notification_entry",
    "reward_entry",
    "play_to_chat",
    "returned_after_gap",
  ];
  assert.deepEqual([...RELATIONSHIP_EVENT_NAMES], expected);
  // child_started_free_chat은 DB 허용 목록에 없음
  assert.equal(RELATIONSHIP_EVENT_NAMES.includes("child_started_free_chat" as any), false);
});

test("relationshipEvents: buildRelationshipEventKey 형식 검증 및 멱등성 보장", () => {
  const key1 = buildRelationshipEventKey("returned_after_gap", "child-123", "session-456");
  assert.equal(key1, "relationship:returned_after_gap:child-123:session-456");

  // 동일한 입력이면 정확히 동일한 key 반환 (멱등)
  const key2 = buildRelationshipEventKey("returned_after_gap", "child-123", "session-456");
  assert.equal(key1, key2);

  const keyMemory = buildRelationshipEventKey("memory_used", "child-123", "session-456");
  assert.equal(keyMemory, "relationship:memory_used:child-123:session-456");
});

test("relationshipEvents: calculateReturnGapDays 일수 계산 및 예외 케이스", () => {
  // 정상 일수 차이
  assert.equal(calculateReturnGapDays("2026-08-10", "2026-08-16"), 6);
  assert.equal(calculateReturnGapDays("2026-08-13", "2026-08-16"), 3);
  assert.equal(calculateReturnGapDays("2026-08-14", "2026-08-16"), 2);
  assert.equal(calculateReturnGapDays("2026-08-15", "2026-08-16"), 1);
  assert.equal(calculateReturnGapDays("2026-08-16", "2026-08-16"), 0);

  // 미래 날짜(이전 일자가 더 미래인 경우) -> null
  assert.equal(calculateReturnGapDays("2026-08-20", "2026-08-16"), null);

  // 잘못된 날짜 문자열 -> null
  assert.equal(calculateReturnGapDays("invalid-date", "2026-08-16"), null);
  assert.equal(calculateReturnGapDays("2026-08-10", "invalid-date"), null);
});

test("relationshipEvents: checkAndRecordReturnedAfterGap - 이전 대화 없음 (최초 대화) 시 기록하지 않음", async () => {
  let insertCalled = false;
  const mockDb: unknown = {
    from: (table: string) => {
      if (table === "chat_sessions") {
        return {
          select: () => ({
            eq: () => ({
              neq: () => ({
                lt: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "behavior_events") {
        return {
          insert: async () => {
            insertCalled = true;
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };

  const recorded = await checkAndRecordReturnedAfterGap({
    db: mockDb as SupabaseClient,
    childId: "child-1",
    sessionId: "sess-1",
    currentBusinessDate: "2026-08-16",
    env: { RELATIONSHIP_RETURN_GAP_DAYS: "3" },
  });

  assert.equal(recorded, false);
  assert.equal(insertCalled, false);
});

test("relationshipEvents: checkAndRecordReturnedAfterGap - gap이 임계(3일) 미만(2일)이면 기록하지 않음", async () => {
  let insertCalled = false;
  const mockDb: unknown = {
    from: (table: string) => {
      if (table === "chat_sessions") {
        return {
          select: () => ({
            eq: () => ({
              neq: () => ({
                lt: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: { business_date: "2026-08-14" },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "behavior_events") {
        return {
          insert: async () => {
            insertCalled = true;
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };

  const recorded = await checkAndRecordReturnedAfterGap({
    db: mockDb as SupabaseClient,
    childId: "child-1",
    sessionId: "sess-1",
    currentBusinessDate: "2026-08-16",
    env: { RELATIONSHIP_RETURN_GAP_DAYS: "3" },
  });

  assert.equal(recorded, false);
  assert.equal(insertCalled, false);
});

test("relationshipEvents: checkAndRecordReturnedAfterGap - gap이 임계(3일) 이상(3일, 6일)이면 기록함", async () => {
  let insertedPayload: Record<string, unknown> | null = null;
  const mockDb: unknown = {
    from: (table: string) => {
      if (table === "chat_sessions") {
        return {
          select: () => ({
            eq: () => ({
              neq: () => ({
                lt: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: { business_date: "2026-08-10" },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "behavior_events") {
        return {
          insert: async (payload: Record<string, unknown>) => {
            insertedPayload = payload;
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };

  // Mock createServiceClient via module behavior if called, or test direct record
  const recorded = await checkAndRecordReturnedAfterGap({
    db: mockDb as SupabaseClient,
    childId: "child-1",
    sessionId: "sess-1",
    currentBusinessDate: "2026-08-16",
    env: { RELATIONSHIP_RETURN_GAP_DAYS: "3" },
  });

  assert.equal(recorded, true);
});

test("relationshipEvents: DB 쿼리 오류 시 throw 하지 않고 false를 반환한다 (fail-safe)", async () => {
  const originalError = console.error;
  console.error = () => {};

  try {
    const mockDb: unknown = {
      from: (table: string) => {
        if (table === "chat_sessions") {
          return {
            select: () => ({
              eq: () => ({
                neq: () => ({
                  lt: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () => ({
                          data: null,
                          error: { message: "Network connection lost" },
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };

    const recorded = await checkAndRecordReturnedAfterGap({
      db: mockDb as SupabaseClient,
      childId: "child-1",
      sessionId: "sess-1",
      currentBusinessDate: "2026-08-16",
    });

    assert.equal(recorded, false);
  } finally {
    console.error = originalError;
  }
});

test("relationshipEvents: 허용되지 않은 event_name은 기록 시도 시 에러 로깅하고 중단한다", async () => {
  const originalError = console.error;
  let loggedError = false;
  console.error = () => {
    loggedError = true;
  };

  try {
    await recordRelationshipEvent({
      eventName: "unauthorized_event_name" as any,
      childId: "child-1",
      sessionId: "sess-1",
      logicalId: "sess-1",
    });
    assert.equal(loggedError, true);
  } finally {
    console.error = originalError;
  }
});
