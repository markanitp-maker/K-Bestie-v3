import assert from "node:assert/strict";
import test from "node:test";

import {
  getCompletedWeekBoundsForRunDateKst,
  getWeekBoundsKst,
} from "./weeklyDates";

test("토요일 06:00 KST 실행은 직전 토요일~금요일 완료 주간을 반환한다", () => {
  const cases = [
    ["2026-08-08", "2026-08-01", "2026-08-07"],
    ["2026-08-15", "2026-08-08", "2026-08-14"],
    ["2026-08-22", "2026-08-15", "2026-08-21"],
  ] as const;

  for (const [runDate, weekStart, weekEnd] of cases) {
    assert.deepEqual(getCompletedWeekBoundsForRunDateKst(runDate), {
      weekStart,
      weekEnd,
    });
  }
});

test("부모 화면의 현재 주간은 토요일~금요일 경계를 사용한다", () => {
  assert.deepEqual(getWeekBoundsKst("2026-08-10"), {
    weekStart: "2026-08-08",
    weekEnd: "2026-08-14",
  });
});
