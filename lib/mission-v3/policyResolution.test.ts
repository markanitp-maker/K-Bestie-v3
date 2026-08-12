import assert from "node:assert/strict";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
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

const makePolicyDb = (
  rows: Array<{ session_id: string }>,
  queryError: { message: string } | null = null,
): SupabaseClient => {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    limit: async () => ({ data: rows, error: queryError }),
  };
  return { from: () => query } as unknown as SupabaseClient;
};

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

test("잘못된 effective_at은 throw하지 않고 v2_dual로 폴백한다", () => {
  withEffectiveAt("not-a-date", () => {
    assert.doesNotThrow(() => {
      assert.deepEqual(resolveMissionPolicyVersion(new Date("2026-01-01T00:00:00.000Z")), {
        version: "v2_dual",
        effectiveAt: null,
      });
    });
  });
});

test("cutover 뒤에도 같은 KST 날짜에 v2 round가 있으면 v2_dual을 유지한다", async () => {
  await withEffectiveAtAsync("2026-08-12T12:00:00+09:00", async () => {
    const result = await resolveMissionPolicyVersionForChild({
      db: makePolicyDb([{ session_id: "legacy-session" }]),
      childId: "child-1",
      now: new Date("2026-08-12T18:00:00+09:00"),
    });

    assert.deepEqual(result, {
      version: "v2_dual",
      effectiveAt: "2026-08-12T03:00:00.000Z",
    });
  });
});

test("cutover 뒤 같은 KST 날짜에 v2 round가 없으면 v3_single_daily를 사용한다", async () => {
  await withEffectiveAtAsync("2026-08-12T00:00:00+09:00", async () => {
    const result = await resolveMissionPolicyVersionForChild({
      db: makePolicyDb([]),
      childId: "child-1",
      now: new Date("2026-08-12T09:00:00+09:00"),
    });

    assert.equal(result.version, "v3_single_daily");
  });
});

test("same-day v2 조회 실패 시 v3 생성을 허용하지 않고 오류를 반환한다", async () => {
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
