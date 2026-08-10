import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveMissionPolicyVersion } from "./policyResolution.js";

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
