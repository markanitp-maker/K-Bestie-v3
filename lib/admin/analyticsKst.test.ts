import assert from "node:assert/strict";
import test from "node:test";
import {
  kstDayEndExclusiveIso,
  kstDayStartIso,
  resolveAnalyticsKstFilters,
  toKstCalendarDate,
} from "./analyticsKst";

test("KST 자정 경계는 UTC 15:00에서 다음 날짜로 바뀐다", () => {
  assert.equal(toKstCalendarDate(new Date("2026-08-09T14:59:59.999Z")), "2026-08-09");
  assert.equal(toKstCalendarDate(new Date("2026-08-09T15:00:00.000Z")), "2026-08-10");
  assert.equal(kstDayStartIso("2026-08-10"), "2026-08-09T15:00:00.000Z");
  assert.equal(kstDayEndExclusiveIso("2026-08-10"), "2026-08-10T15:00:00.000Z");
});

test("공통 필터는 지난달·직접기간·내부테스트 기본 제외를 한 helper에서 계산한다", () => {
  const now = new Date("2026-08-10T03:00:00+09:00");
  const lastMonth = resolveAnalyticsKstFilters(new URLSearchParams("period=lastmonth"), now);
  assert.equal(lastMonth.from, "2026-07-01");
  assert.equal(lastMonth.to, "2026-07-31");
  assert.equal(lastMonth.internalTest, "exclude");
  assert.equal(lastMonth.timezone, "Asia/Seoul");
  assert.throws(() => resolveAnalyticsKstFilters(new URLSearchParams("period=custom&from=2026-08-11&to=2026-08-10"), now));
  const longRange = resolveAnalyticsKstFilters(new URLSearchParams("period=custom&from=2025-01-01&to=2026-08-10"), now);
  assert.equal(longRange.from, "2025-01-01");
  assert.equal(longRange.to, "2026-08-10");
});
