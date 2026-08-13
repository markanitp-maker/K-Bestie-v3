import assert from "node:assert/strict";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isV2ProgressRow,
  isV3ProgressRow,
  resolveMissionPolicyVersion,
  resolveMissionPolicyVersionForChild,
} from "./policyResolution.js";

const withEffectiveAt = (value: string | undefined, callback: () => void): void => {
  const previousValue = process.env.MISSION_V3_EFFECTIVE_AT;

  try {
    if (value === undefined) {
      delete process.env.MISSION_V3_EFFECTIVE_AT;
    } else {
      process.env.MISSION_V3_EFFECTIVE_AT = value;
    }
    callback();
  } finally {
    if (previousValue === undefined) {
      delete process.env.MISSION_V3_EFFECTIVE_AT;
    } else {
      process.env.MISSION_V3_EFFECTIVE_AT = previousValue;
    }
  }
};

const withEffectiveAtAsync = async (
  value: string | undefined,
  callback: () => Promise<void>,
): Promise<void> => {
  const previousValue = process.env.MISSION_V3_EFFECTIVE_AT;
  try {
    if (value === undefined) delete process.env.MISSION_V3_EFFECTIVE_AT;
    else process.env.MISSION_V3_EFFECTIVE_AT = value;
    await callback();
  } finally {
    if (previousValue === undefined) delete process.env.MISSION_V3_EFFECTIVE_AT;
    else process.env.MISSION_V3_EFFECTIVE_AT = previousValue;
  }
};

/**
 * 20260810220000_mission_v3_daily_single_policy.sql 및 선행 스키마(20260711100000, 20260717150000, 20260721300000)를
 * 완전히 반영한 Mock 행 인터페이스 (any 제거 및 필수 필드 고정)
 */
export interface MockProgressRow {
  session_id: string;
  child_id: string;
  business_date: string;
  round_type: "round1_day" | "round2_night" | "common" | "daily_single";
  mission_policy_version: "v2_dual" | "v3_single_daily";
  effective_at: string | null;
  valid_answer_count: number;
  required_valid_count: number;
  status: string | null;
  created_at: string;
  updated_at: string;
}

export interface MockChatSessionRow {
  id: string;
  child_id: string;
  session_type: "mission" | "free";
  business_date: string;
  started_at: string;
  ended_at: string | null;
  turn_count: number;
}

type MockRow = MockProgressRow | MockChatSessionRow;

export interface MockDbOptions {
  progressRows?: MockProgressRow[];
  progressError?: { message: string } | null;
  sessionRows?: MockChatSessionRow[];
  sessionError?: { message: string } | null;
}

export const createMockProgressRow = (
  overrides: Partial<MockProgressRow> & { session_id: string },
): MockProgressRow => {
  const isV3 =
    overrides.mission_policy_version === "v3_single_daily" ||
    overrides.round_type === "daily_single";

  return {
    session_id: overrides.session_id,
    child_id: overrides.child_id ?? "child-1",
    business_date: overrides.business_date ?? "2026-08-12",
    round_type: overrides.round_type ?? (isV3 ? "daily_single" : "round1_day"),
    mission_policy_version:
      overrides.mission_policy_version ?? (isV3 ? "v3_single_daily" : "v2_dual"),
    effective_at:
      overrides.effective_at !== undefined
        ? overrides.effective_at
        : isV3
          ? "2026-08-12T00:00:00.000Z"
          : null,
    valid_answer_count: overrides.valid_answer_count ?? 0,
    required_valid_count: overrides.required_valid_count ?? (isV3 ? 3 : 5),
    status: overrides.status !== undefined ? overrides.status : "IN_PROGRESS",
    created_at: overrides.created_at ?? "2026-08-12T09:00:00+09:00",
    updated_at: overrides.updated_at ?? "2026-08-12T09:00:00+09:00",
  };
};

export const createMockChatSessionRow = (
  overrides: Partial<MockChatSessionRow> & { id: string },
): MockChatSessionRow => ({
  id: overrides.id,
  child_id: overrides.child_id ?? "child-1",
  session_type: overrides.session_type ?? "mission",
  business_date: overrides.business_date ?? "2026-08-14",
  started_at: overrides.started_at ?? "2026-08-14T09:00:00+09:00",
  ended_at: overrides.ended_at ?? null,
  turn_count: overrides.turn_count ?? 0,
});

interface MockQueryResult<T>
  extends PromiseLike<{ data: T[] | null; error: { message: string } | null }> {
  select: (...args: unknown[]) => MockQueryResult<T>;
  eq: (column: string, value: unknown) => MockQueryResult<T>;
  in: (column: string, values: unknown[]) => MockQueryResult<T>;
  lt: (column: string, value: string) => MockQueryResult<T>;
  limit: (n?: number) => Promise<{ data: T[] | null; error: { message: string } | null }>;
}

const makePolicyDb = (
  progressRowsOrOptions: MockProgressRow[] | MockDbOptions,
  queryError: { message: string } | null = null,
): SupabaseClient => {
  let progressRows: MockProgressRow[] = [];
  let progressError: { message: string } | null = null;
  let sessionRows: MockChatSessionRow[] = [];
  let sessionError: { message: string } | null = null;

  if (Array.isArray(progressRowsOrOptions)) {
    progressRows = progressRowsOrOptions;
    progressError = queryError;
  } else {
    progressRows = progressRowsOrOptions.progressRows ?? [];
    progressError = progressRowsOrOptions.progressError ?? queryError;
    sessionRows = progressRowsOrOptions.sessionRows ?? [];
    sessionError = progressRowsOrOptions.sessionError ?? null;
  }

  return {
    from: (tableName: string) => {
      const isSessionTable = tableName === "chat_sessions";
      let filteredRows: MockRow[] = isSessionTable ? [...sessionRows] : [...progressRows];
      const currentError = isSessionTable ? sessionError : progressError;

      const createQuery = (): MockQueryResult<MockRow> => {
        const query: MockQueryResult<MockRow> = {
          select: () => query,
          eq: (column: string, value: unknown) => {
            filteredRows = filteredRows.filter((r) => {
              if (!(column in r)) return false;
              const rowVal = (r as Record<string, unknown>)[column];
              if (rowVal === undefined || rowVal === null) {
                return value === null;
              }
              return String(rowVal) === String(value);
            });
            return query;
          },
          in: (column: string, values: unknown[]) => {
            filteredRows = filteredRows.filter((r) => {
              if (!(column in r)) return false;
              const rowVal = (r as Record<string, unknown>)[column];
              if (rowVal === undefined || rowVal === null) return false;
              return values.map(String).includes(String(rowVal));
            });
            return query;
          },
          lt: (column: string, value: string) => {
            filteredRows = filteredRows.filter((r) => {
              if (!(column in r)) return false;
              const rowVal = (r as Record<string, unknown>)[column];
              if (rowVal === undefined || rowVal === null) return false;
              const rowTime = new Date(String(rowVal)).getTime();
              const targetTime = new Date(value).getTime();
              if (Number.isFinite(rowTime) && Number.isFinite(targetTime)) {
                return rowTime < targetTime;
              }
              return String(rowVal) < value;
            });
            return query;
          },
          limit: async (n?: number) => {
            if (currentError) {
              return { data: null, error: currentError };
            }
            return {
              data: typeof n === "number" ? filteredRows.slice(0, n) : filteredRows,
              error: null,
            };
          },
          then: (onfulfilled, onrejected) => {
            const result = currentError
              ? { data: null, error: currentError }
              : { data: filteredRows, error: null };
            return Promise.resolve(result).then(onfulfilled, onrejected);
          },
        };
        return query;
      };

      return createQuery();
    },
  } as unknown as SupabaseClient;
};

// =================== 단위 검증: resolveMissionPolicyVersion ===================

test("MISSION_V3_EFFECTIVE_AT이 미설정이면 안전하게 v2_dual을 반환한다", () => {
  withEffectiveAt(undefined, () => {
    assert.deepEqual(resolveMissionPolicyVersion(new Date("2026-01-01T00:00:00.000Z")), {
      version: "v2_dual",
      effectiveAt: null,
    });
  });
});

test("MISSION_V3_EFFECTIVE_AT이 빈 문자열이면 안전하게 v2_dual을 반환한다", () => {
  withEffectiveAt("", () => {
    assert.deepEqual(resolveMissionPolicyVersion(new Date("2026-01-01T00:00:00.000Z")), {
      version: "v2_dual",
      effectiveAt: null,
    });
  });
});

test("미래 effective_at이면 v2_dual과 예정된 effectiveAt을 반환한다", () => {
  withEffectiveAt("2026-01-02T00:00:00+09:00", () => {
    assert.deepEqual(resolveMissionPolicyVersion(new Date("2026-01-01T00:00:00+09:00")), {
      version: "v2_dual",
      effectiveAt: "2026-01-01T15:00:00.000Z",
    });
  });
});

test("과거 effective_at이면 v3_single_daily를 반환한다", () => {
  withEffectiveAt("2026-01-01T00:00:00+09:00", () => {
    assert.deepEqual(resolveMissionPolicyVersion(new Date("2026-01-02T00:00:00+09:00")), {
      version: "v3_single_daily",
      effectiveAt: "2025-12-31T15:00:00.000Z",
    });
  });
});

test("잘못된 effective_at은 throw하지 않고 v2_dual로 폴백한다 (에러 로그 기록)", () => {
  withEffectiveAt("not-a-date", () => {
    assert.doesNotThrow(() => {
      assert.deepEqual(resolveMissionPolicyVersion(new Date("2026-01-01T00:00:00.000Z")), {
        version: "v2_dual",
        effectiveAt: null,
      });
    });
  });
});

// =================== 행 판별 헬퍼 테스트 ===================

test("isV2ProgressRow와 isV3ProgressRow가 스키마 정의대로 행을 구분한다", () => {
  const legacyRow: MockProgressRow = createMockProgressRow({
    session_id: "s1",
    mission_policy_version: "v2_dual",
    round_type: "round1_day",
    effective_at: null,
  });
  const v3Row: MockProgressRow = createMockProgressRow({
    session_id: "s2",
    mission_policy_version: "v3_single_daily",
    round_type: "daily_single",
    effective_at: "2026-08-12T03:00:00.000Z",
  });

  assert.equal(isV2ProgressRow(legacyRow), true);
  assert.equal(isV3ProgressRow(legacyRow), false);

  assert.equal(isV2ProgressRow(v3Row), false);
  assert.equal(isV3ProgressRow(v3Row), true);
});

// =================== 필수 9개 요구사항 테스트 ===================

// 케이스 1: 당일 v2 행 보유 + env 설정됨 → v2
test("케이스 1: 당일 v2 행 보유 + env 설정됨 → v2_dual 유지", async () => {
  await withEffectiveAtAsync("2026-08-12T12:00:00+09:00", async () => {
    const result = await resolveMissionPolicyVersionForChild({
      db: makePolicyDb([
        createMockProgressRow({
          session_id: "legacy-session",
          child_id: "child-1",
          mission_policy_version: "v2_dual",
          round_type: "round1_day",
          effective_at: null,
          business_date: "2026-08-12",
        }),
      ]),
      childId: "child-1",
      now: new Date("2026-08-12T18:00:00+09:00"),
    });

    assert.deepEqual(result, {
      version: "v2_dual",
      effectiveAt: "2026-08-12T03:00:00.000Z",
    });
  });
});

// 케이스 2: 당일 v3 행 보유 + env unset (롤백 상황) → v3 (핵심)
test("케이스 2: 당일 v3 행 보유 + env unset (롤백 상황) → v3_single_daily 유지 (양방향 sticky 핵심)", async () => {
  await withEffectiveAtAsync(undefined, async () => {
    const result = await resolveMissionPolicyVersionForChild({
      db: makePolicyDb([
        createMockProgressRow({
          session_id: "v3-session",
          child_id: "child-1",
          mission_policy_version: "v3_single_daily",
          round_type: "daily_single",
          effective_at: "2026-08-12T00:00:00.000Z",
          business_date: "2026-08-12",
        }),
      ]),
      childId: "child-1",
      now: new Date("2026-08-12T10:00:00+09:00"),
    });

    assert.deepEqual(result, {
      version: "v3_single_daily",
      effectiveAt: "2026-08-12T00:00:00.000Z",
    });
  });
});

// 케이스 3: 당일 v3 행 보유 + env 설정됨 → v3
test("케이스 3: 당일 v3 행 보유 + env 설정됨 → v3_single_daily 유지", async () => {
  await withEffectiveAtAsync("2026-08-12T00:00:00+09:00", async () => {
    const result = await resolveMissionPolicyVersionForChild({
      db: makePolicyDb([
        createMockProgressRow({
          session_id: "v3-session",
          child_id: "child-1",
          mission_policy_version: "v3_single_daily",
          round_type: "daily_single",
          effective_at: "2026-08-12T00:00:00.000Z",
          business_date: "2026-08-12",
        }),
      ]),
      childId: "child-1",
      now: new Date("2026-08-12T10:00:00+09:00"),
    });

    assert.deepEqual(result, {
      version: "v3_single_daily",
      effectiveAt: "2026-08-12T00:00:00.000Z",
    });
  });
});

// 케이스 4: 당일 행 없음 + env unset → v2
test("케이스 4: 당일 행 없음 + env unset → v2_dual", async () => {
  await withEffectiveAtAsync(undefined, async () => {
    const result = await resolveMissionPolicyVersionForChild({
      db: makePolicyDb([]),
      childId: "child-1",
      now: new Date("2026-08-12T10:00:00+09:00"),
    });

    assert.deepEqual(result, {
      version: "v2_dual",
      effectiveAt: null,
    });
  });
});

// 케이스 5: 당일 행 없음 + env 설정됨(과거 시각) → v3
test("케이스 5: 당일 행 없음 + env 설정됨(과거 시각) → v3_single_daily", async () => {
  await withEffectiveAtAsync("2026-08-12T00:00:00+09:00", async () => {
    const result = await resolveMissionPolicyVersionForChild({
      db: makePolicyDb([]),
      childId: "child-1",
      now: new Date("2026-08-12T10:00:00+09:00"),
    });

    assert.deepEqual(result, {
      version: "v3_single_daily",
      effectiveAt: "2026-08-11T15:00:00.000Z",
    });
  });
});

// 케이스 6: 당일 행 없음 + env 설정됨(미래 시각) → v2
test("케이스 6: 당일 행 없음 + env 설정됨(미래 시각) → v2_dual", async () => {
  await withEffectiveAtAsync("2026-08-13T00:00:00+09:00", async () => {
    const result = await resolveMissionPolicyVersionForChild({
      db: makePolicyDb([]),
      childId: "child-1",
      now: new Date("2026-08-12T10:00:00+09:00"),
    });

    assert.deepEqual(result, {
      version: "v2_dual",
      effectiveAt: "2026-08-12T15:00:00.000Z",
    });
  });
});

// 케이스 7: 당일 v2 행 + v3 행 동시 존재 → fail-closed(차단 상태)
test("케이스 7: 당일 v2 행 + v3 행 동시 존재 → fail-closed 차단 상태 (isMixed: true)", async () => {
  await withEffectiveAtAsync("2026-08-12T00:00:00+09:00", async () => {
    const result = await resolveMissionPolicyVersionForChild({
      db: makePolicyDb([
        createMockProgressRow({
          session_id: "legacy-session",
          child_id: "child-1",
          mission_policy_version: "v2_dual",
          round_type: "round1_day",
          effective_at: null,
          business_date: "2026-08-12",
        }),
        createMockProgressRow({
          session_id: "v3-session",
          child_id: "child-1",
          mission_policy_version: "v3_single_daily",
          round_type: "daily_single",
          effective_at: "2026-08-12T00:00:00.000Z",
          business_date: "2026-08-12",
        }),
      ]),
      childId: "child-1",
      now: new Date("2026-08-12T10:00:00+09:00"),
    });

    assert.equal(result.isMixed, true);
    assert.equal(result.blockedReason, "mixed_policy");
    assert.equal(result.version, "v2_dual");
  });
});

// 케이스 8: env가 잘못된 문자열 → v2 폴백 + 오류 로그
test("케이스 8: 당일 행 없음 + env가 잘못된 문자열 → v2_dual 폴백", async () => {
  await withEffectiveAtAsync("invalid-date-string", async () => {
    const result = await resolveMissionPolicyVersionForChild({
      db: makePolicyDb([]),
      childId: "child-1",
      now: new Date("2026-08-12T10:00:00+09:00"),
    });

    assert.deepEqual(result, {
      version: "v2_dual",
      effectiveAt: null,
    });
  });
});

// 케이스 9: 전날 v3 행만 있고 당일 행 없음 → env 기준으로 판정 (전날 행에 끌려가지 않음)
test("케이스 9: 전날 v3 행만 있고 당일 행 없음 → env 기준으로 판정 (전날 행에 끌려가지 않음)", async () => {
  // env가 unset인 상황에서 어제 v3 미션을 완료했더라도, 오늘은 새 날이므로 env(v2)를 따라야 함
  await withEffectiveAtAsync(undefined, async () => {
    const result = await resolveMissionPolicyVersionForChild({
      db: makePolicyDb([
        createMockProgressRow({
          session_id: "yesterday-v3-session",
          child_id: "child-1",
          mission_policy_version: "v3_single_daily",
          round_type: "daily_single",
          effective_at: "2026-08-11T00:00:00.000Z",
          business_date: "2026-08-11", // 전날 날짜
        }),
      ]),
      childId: "child-1",
      now: new Date("2026-08-12T10:00:00+09:00"), // 오늘 날짜
    });

    assert.deepEqual(result, {
      version: "v2_dual",
      effectiveAt: null,
    });
  });

  // 반대로 env가 설정된 상황에서 어제 v2 미션을 했더라도, 오늘은 행이 없으므로 env(v3)를 따라야 함
  await withEffectiveAtAsync("2026-08-12T00:00:00+09:00", async () => {
    const result = await resolveMissionPolicyVersionForChild({
      db: makePolicyDb([
        createMockProgressRow({
          session_id: "yesterday-v2-session",
          child_id: "child-1",
          mission_policy_version: "v2_dual",
          round_type: "round1_day",
          effective_at: null,
          business_date: "2026-08-11", // 전날 날짜
        }),
      ]),
      childId: "child-1",
      now: new Date("2026-08-12T10:00:00+09:00"), // 오늘 날짜
    });

    assert.deepEqual(result, {
      version: "v3_single_daily",
      effectiveAt: "2026-08-11T15:00:00.000Z",
    });
  });
});

// DB 조회 오류 시 reject 테스트 (기존 테스트 보존)
test("same-day 조회 실패 시 v3 생성을 허용하지 않고 오류를 throw한다", async () => {
  await withEffectiveAtAsync("2026-08-12T00:00:00+09:00", async () => {
    await assert.rejects(
      resolveMissionPolicyVersionForChild({
        db: makePolicyDb([], { message: "database unavailable" }),
        childId: "child-1",
        now: new Date("2026-08-12T09:00:00+09:00"),
      }),
      /당일 v2 미션 조회 실패/,
    );
  });
});

// =================== cutover sticky 원자성 보강 테스트 (P0) ===================

test("케이스 10: progress 없음 + 당일 mission session started_at이 cutover 1ms 전 + 현재시각 cutover 후 → v2_dual 유지 & legacy guard 통과", async () => {
  const cutover = "2026-08-14T01:00:00+09:00";
  await withEffectiveAtAsync(cutover, async () => {
    const result = await resolveMissionPolicyVersionForChild({
      db: makePolicyDb({
        progressRows: [],
        sessionRows: [
          createMockChatSessionRow({
            id: "pre-cutover-session-1",
            child_id: "child-1",
            session_type: "mission",
            business_date: "2026-08-14",
            started_at: "2026-08-14T00:59:59.999+09:00",
          }),
        ],
      }),
      childId: "child-1",
      now: new Date("2026-08-14T01:05:00+09:00"),
    });

    assert.equal(result.version, "v2_dual");
    assert.equal(result.isMixed, undefined);

    // legacy guard 조건 검증: version === "v3_single_daily" || isMixed 가 false임을 직접 assert (403 차단 방지)
    const isBlockedByLegacyGuard = result.version === "v3_single_daily" || Boolean(result.isMixed);
    assert.equal(isBlockedByLegacyGuard, false);
  });
});

test("케이스 11: progress 없음 + session started_at이 cutover와 같거나 이후 → env 기준 v3_single_daily", async () => {
  const cutover = "2026-08-14T01:00:00+09:00";
  await withEffectiveAtAsync(cutover, async () => {
    // 1) cutover 정각 (started_at == effectiveAt)
    const resultExact = await resolveMissionPolicyVersionForChild({
      db: makePolicyDb({
        progressRows: [],
        sessionRows: [
          createMockChatSessionRow({
            id: "post-cutover-session-exact",
            child_id: "child-1",
            session_type: "mission",
            business_date: "2026-08-14",
            started_at: "2026-08-14T01:00:00.000+09:00",
          }),
        ],
      }),
      childId: "child-1",
      now: new Date("2026-08-14T01:05:00+09:00"),
    });
    assert.equal(resultExact.version, "v3_single_daily");

    // 2) cutover 이후 (started_at > effectiveAt)
    const resultAfter = await resolveMissionPolicyVersionForChild({
      db: makePolicyDb({
        progressRows: [],
        sessionRows: [
          createMockChatSessionRow({
            id: "post-cutover-session-after",
            child_id: "child-1",
            session_type: "mission",
            business_date: "2026-08-14",
            started_at: "2026-08-14T01:01:00.000+09:00",
          }),
        ],
      }),
      childId: "child-1",
      now: new Date("2026-08-14T01:05:00+09:00"),
    });
    assert.equal(resultAfter.version, "v3_single_daily");
  });
});

test("케이스 12: 전날 pre-cutover session만 존재 → 오늘 판정에 영향 없음 (cutover 후 v3_single_daily)", async () => {
  const cutover = "2026-08-14T01:00:00+09:00";
  await withEffectiveAtAsync(cutover, async () => {
    const result = await resolveMissionPolicyVersionForChild({
      db: makePolicyDb({
        progressRows: [],
        sessionRows: [
          createMockChatSessionRow({
            id: "yesterday-session",
            child_id: "child-1",
            session_type: "mission",
            business_date: "2026-08-13",
            started_at: "2026-08-13T20:00:00.000+09:00",
          }),
        ],
      }),
      childId: "child-1",
      now: new Date("2026-08-14T02:00:00+09:00"),
    });

    assert.equal(result.version, "v3_single_daily");
  });
});

test("케이스 13: v3 progress + 당일 pre-cutover orphan 동시 존재 → isMixed: true fail-closed", async () => {
  const cutover = "2026-08-14T01:00:00+09:00";
  await withEffectiveAtAsync(cutover, async () => {
    const result = await resolveMissionPolicyVersionForChild({
      db: makePolicyDb({
        progressRows: [
          createMockProgressRow({
            session_id: "v3-session-id",
            child_id: "child-1",
            mission_policy_version: "v3_single_daily",
            round_type: "daily_single",
            effective_at: "2026-08-14T01:00:00.000+09:00",
            business_date: "2026-08-14",
          }),
        ],
        sessionRows: [
          createMockChatSessionRow({
            id: "pre-cutover-orphan-session",
            child_id: "child-1",
            session_type: "mission",
            business_date: "2026-08-14",
            started_at: "2026-08-14T00:30:00.000+09:00",
          }),
        ],
      }),
      childId: "child-1",
      now: new Date("2026-08-14T02:00:00+09:00"),
    });

    assert.equal(result.isMixed, true);
    assert.equal(result.blockedReason, "mixed_policy");
    assert.equal(result.version, "v2_dual");
  });
});

test("케이스 14: chat_sessions 조회 오류 시 resolver가 reject하여 v3 생성을 차단한다", async () => {
  const cutover = "2026-08-14T01:00:00+09:00";
  await withEffectiveAtAsync(cutover, async () => {
    await assert.rejects(
      resolveMissionPolicyVersionForChild({
        db: makePolicyDb({
          progressRows: [],
          sessionError: { message: "chat_sessions connection error" },
        }),
        childId: "child-1",
        now: new Date("2026-08-14T02:00:00+09:00"),
      }),
      /당일 pre-cutover 미션 세션 조회 실패/,
    );
  });
});

test("케이스 15: env 제거 + 당일 v3 progress → 기존대로 v3_single_daily 유지 (롤백 호환)", async () => {
  await withEffectiveAtAsync(undefined, async () => {
    const result = await resolveMissionPolicyVersionForChild({
      db: makePolicyDb({
        progressRows: [
          createMockProgressRow({
            session_id: "v3-session-id",
            child_id: "child-1",
            mission_policy_version: "v3_single_daily",
            round_type: "daily_single",
            effective_at: "2026-08-14T01:00:00.000+09:00",
            business_date: "2026-08-14",
          }),
        ],
        sessionRows: [],
      }),
      childId: "child-1",
      now: new Date("2026-08-14T02:00:00+09:00"),
    });

    assert.deepEqual(result, {
      version: "v3_single_daily",
      effectiveAt: "2026-08-14T01:00:00.000+09:00",
    });
  });
});

test("케이스 16: env 제거 + 당일 v2 progress → 기존대로 v2_dual 유지", async () => {
  await withEffectiveAtAsync(undefined, async () => {
    const result = await resolveMissionPolicyVersionForChild({
      db: makePolicyDb({
        progressRows: [
          createMockProgressRow({
            session_id: "v2-session-id",
            child_id: "child-1",
            mission_policy_version: "v2_dual",
            round_type: "round1_day",
            effective_at: null,
            business_date: "2026-08-14",
          }),
        ],
        sessionRows: [],
      }),
      childId: "child-1",
      now: new Date("2026-08-14T02:00:00+09:00"),
    });

    assert.deepEqual(result, {
      version: "v2_dual",
      effectiveAt: null,
    });
  });
});
