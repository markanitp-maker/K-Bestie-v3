import assert from "node:assert/strict";
import test from "node:test";
import {
  filterCohortsByRange,
  resolveAnalyticsFilters,
  subtractCohorts,
  subtractOverview,
  subtractRows,
} from "./analytics";

test("통합 분석 기본 필터는 최근 7일·전체·내부 테스트 제외다", () => {
  assert.deepEqual(resolveAnalyticsFilters(new URLSearchParams(), "2026-08-08"), {
    period: "7d",
    scope: "all",
    internalTest: "exclude",
    from: "2026-08-02",
    to: "2026-08-08",
    timezone: "Asia/Seoul",
  });
});

test("지난달과 직접 기간은 KST 달력 경계로 해석한다", () => {
  assert.deepEqual(resolveAnalyticsFilters(new URLSearchParams("period=lastmonth"), "2026-08-08"), {
    period: "lastmonth", scope: "all", internalTest: "exclude", from: "2026-07-01", to: "2026-07-31", timezone: "Asia/Seoul",
  });
  assert.throws(() => resolveAnalyticsFilters(new URLSearchParams("period=custom&from=2026-08-09&to=2026-08-08"), "2026-08-08"));
});

test("테스트만 집계는 포함 값에서 일반 값만 빼고 음수를 만들지 않는다", () => {
  const result = subtractOverview(
    { kpis: { activeChildren: { value: 8, prevValue: 4 } }, dailyTrend: [{ date: "2026-08-08", activeChildren: 6 }] },
    { kpis: { activeChildren: { value: 5, prevValue: 4 } }, dailyTrend: [{ date: "2026-08-08", activeChildren: 4 }] },
  );
  assert.deepEqual(result.kpis.activeChildren, { value: 3, prevValue: 0, deltaPct: null });
  assert.equal(result.dailyTrend[0].activeChildren, 2);
});

test("미완성 코호트는 분모가 0이면 0%가 아니라 null로 유지한다", () => {
  const result = subtractCohorts(
    { cohorts: [{ cohortWeekStart: "2026-08-03", size: 2, d1: { numerator: 1, denominator: 1 } }] },
    { cohorts: [{ cohortWeekStart: "2026-08-03", size: 1, d1: { numerator: 1, denominator: 1 } }] },
  );
  assert.equal(result.cohorts[0].d1.rate, null);
  assert.equal(result.summary.d1.rate, null);
});

test("코호트 기간과 테스트 전용 상세 행은 동일 식별자로 필터한다", () => {
  const filtered = filterCohortsByRange({ cohorts: [
    { cohortWeekStart: "2026-07-27", size: 2, d1: { numerator: 1, denominator: 2 } },
    { cohortWeekStart: "2026-08-03", size: 1, d1: { numerator: 1, denominator: 1 } },
  ] }, "2026-08-01", "2026-08-08");
  assert.equal(filtered.cohorts.length, 1);
  assert.equal(filtered.summary.d1.rate, 1);
  assert.deepEqual(subtractRows([{ childId: "a" }, { childId: "b" }], [{ childId: "a" }], ["childId"]), [{ childId: "b" }]);
});
