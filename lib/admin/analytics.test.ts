import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnalyticsKpis,
  filterCohortsByRange,
  isCohortDateInRange,
  resolveAnalyticsFilters,
  subtractCohorts,
  subtractOverview,
  subtractRows,
  summarizeCohorts,
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

test("개별 가입일 기준 기간 필터: 가입일이 from~to 안이면 포함, 밖이면 제외", () => {
  assert.equal(isCohortDateInRange("2026-08-12", "2026-08-12", "2026-08-18"), true);
  assert.equal(isCohortDateInRange("2026-08-18", "2026-08-12", "2026-08-18"), true);
  assert.equal(isCohortDateInRange("2026-08-11", "2026-08-12", "2026-08-18"), false);
  assert.equal(isCohortDateInRange("2026-08-19", "2026-08-12", "2026-08-18"), false);
  assert.equal(isCohortDateInRange("", "2026-08-12", "2026-08-18"), false);
});

test("주 시작이 from보다 앞서도 가입일이 범위 안이면 포함된다 (핵심 버그 수정 검증)", () => {
  const weekStart = "2026-08-10";
  const userSignupDate = "2026-08-12";
  const from = "2026-08-12";
  const to = "2026-08-18";

  assert.equal(weekStart < from, true);
  assert.equal(isCohortDateInRange(userSignupDate, from, to), true);
});

test("filterCohortsByRange는 주차로 자르지 않고 payload를 보존하며 summary 정합성을 유지한다", () => {
  const filtered = filterCohortsByRange({ cohorts: [
    { cohortWeekStart: "2026-07-27", size: 2, d1: { numerator: 1, denominator: 2 } },
    { cohortWeekStart: "2026-08-03", size: 1, d1: { numerator: 1, denominator: 1 } },
  ] }, "2026-08-01", "2026-08-08");
  assert.equal(filtered.cohorts.length, 2);
  assert.equal(filtered.summary.d1.numerator, 2);
  assert.equal(filtered.summary.d1.denominator, 3);
  assert.equal(filtered.summary.d1.rate, 2 / 3);
  assert.deepEqual(subtractRows([{ childId: "a" }, { childId: "b" }], [{ childId: "a" }], ["childId"]), [{ childId: "b" }]);
});

test("상단 공식 KPI는 D1·D7·D30이며 eligible(denominator)=0이면 rate는 null이다", () => {
  const summary = summarizeCohorts([
    {
      cohortWeekStart: "2026-08-10",
      size: 5,
      d1: { numerator: 3, denominator: 5 },
      d7: { numerator: 1, denominator: 2 },
      d30: { numerator: 0, denominator: 0 },
    },
  ]);
  assert.equal(summary.d1.rate, 3 / 5);
  assert.equal(summary.d7.rate, 1 / 2);
  assert.equal(summary.d30.rate, null);

  const kpis = buildAnalyticsKpis({
    filters: { scope: "all" },
    retention: { cohort: { summary } },
  });
  const kpiMap = new Map(kpis.map((k) => [k.key, k]));
  assert.equal(kpiMap.has("d1"), true);
  assert.equal(kpiMap.has("d7"), true);
  assert.equal(kpiMap.has("d30"), true);
  assert.equal(kpiMap.has("d3"), false);

  assert.equal(kpiMap.get("d1")?.value, 60);
  assert.equal(kpiMap.get("d1")?.numerator, 3);
  assert.equal(kpiMap.get("d1")?.denominator, 5);

  assert.equal(kpiMap.get("d7")?.value, 50);
  assert.equal(kpiMap.get("d7")?.numerator, 1);
  assert.equal(kpiMap.get("d7")?.denominator, 2);

  assert.equal(kpiMap.get("d30")?.value, null);
  assert.equal(kpiMap.get("d30")?.numerator, 0);
  assert.equal(kpiMap.get("d30")?.denominator, 0);
});
