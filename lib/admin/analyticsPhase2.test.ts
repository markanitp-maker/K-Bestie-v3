import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildActivityRetention,
  fetchAllAnalyticsRows,
  groupAnalyticsRowsByFamily,
  matchesInternalTestMode,
  stableAnalyticsRef,
} from "./analyticsPhase2";

test("내부 테스트 가족은 기본 제외하고 include/only 모드를 정확히 분리한다", () => {
  const testFamilies = new Set(["family-test"]);
  assert.equal(matchesInternalTestMode("family-real", testFamilies, "exclude"), true);
  assert.equal(matchesInternalTestMode("family-test", testFamilies, "exclude"), false);
  assert.equal(matchesInternalTestMode("family-test", testFamilies, "include"), true);
  assert.equal(matchesInternalTestMode("family-test", testFamilies, "only"), true);
  assert.equal(matchesInternalTestMode("family-real", testFamilies, "only"), false);
});

test("미완성 리텐션 코호트는 0%가 아니라 accumulating/null이며 성숙 후에만 계산한다", () => {
  const points = [
    { unitId: "child-a", occurredAt: "2026-08-01T01:00:00Z" },
    { unitId: "child-a", occurredAt: "2026-08-02T01:00:00Z" },
  ];
  const immature = buildActivityRetention(points, "2026-08-01");
  assert.deepEqual(immature.d7, { numerator: null, denominator: null, rate: null, status: "accumulating", window: "D7" });
  const mature = buildActivityRetention(points, "2026-08-20");
  assert.equal(mature.d1.denominator, 1);
  assert.equal(mature.d1.rate, 100);
  assert.equal(mature.d7.rate, 0);
});

test("동일 타임스탬프가 1000행 경계에 걸려도 고유 키 보조 정렬로 누락·중복 없이 읽는다", async () => {
  const source = Array.from({ length: 1_001 }, (_, index) => ({
    id: 1_001 - index,
    occurred_at: "2026-08-10T00:00:00.000Z",
  }));
  const orderCalls: string[][] = [];
  const rows = await fetchAllAnalyticsRows<{ id: number; occurred_at: string }>(() => {
    const columns: string[] = [];
    const query = {
      order(column: string) {
        columns.push(column);
        return query;
      },
      range(from: number, to: number) {
        orderCalls.push([...columns]);
        const ordered = [...source].sort((left, right) => left.occurred_at.localeCompare(right.occurred_at) || left.id - right.id);
        return Promise.resolve({ data: ordered.slice(from, to + 1), error: null });
      },
    };
    return query;
  }, { column: "occurred_at", uniqueColumn: "id" });
  assert.equal(rows.length, 1_001);
  assert.deepEqual(rows.map((row) => row.id), Array.from({ length: 1_001 }, (_, index) => index + 1));
  assert.deepEqual(orderCalls, [["occurred_at", "id"], ["occurred_at", "id"]]);

  const raw = "123e4567-e89b-12d3-a456-426614174000";
  const ref = stableAnalyticsRef(raw);
  assert.equal(ref.length, 16);
  assert.equal(ref.includes(raw), false);
});

test("가족 Map 그룹핑은 기존 가족별 filter 방식과 동일한 행을 반환한다", () => {
  const rows = [
    { id: "event-1", familyId: "family-a" },
    { id: "event-2", familyId: "family-b" },
    { id: "event-3", familyId: "family-a" },
    { id: "event-orphan", familyId: null },
  ];
  const grouped = groupAnalyticsRowsByFamily(rows, (row) => row.familyId);
  for (const familyId of ["family-a", "family-b", "family-c"]) {
    assert.deepEqual(grouped.get(familyId) ?? [], rows.filter((row) => row.familyId === familyId));
  }
});

test("가입일 코호트는 조회 시작일에 따라 첫 관측 활동이 달라져도 고정된다", () => {
  const cohortDates = new Map([["child-a", "2026-08-01"]]);
  const earlierRange = buildActivityRetention([
    { unitId: "child-a", occurredAt: "2026-08-01T01:00:00Z" },
    { unitId: "child-a", occurredAt: "2026-08-08T01:00:00Z" },
  ], "2026-08-20", cohortDates);
  const laterRange = buildActivityRetention([
    { unitId: "child-a", occurredAt: "2026-08-05T01:00:00Z" },
    { unitId: "child-a", occurredAt: "2026-08-08T01:00:00Z" },
  ], "2026-08-20", cohortDates);
  assert.equal(earlierRange.d7.rate, 100);
  assert.equal(laterRange.d7.rate, 100);
});

test("기간으로 잘린 활동만 넘기면 가입일이 오래된 코호트의 리텐션이 구조적으로 0이 된다 — 전체 이력을 넘겨야 정상 계산된다 (R-1 회귀)", () => {
  const cohortDates = new Map([["child-old", "2026-01-01"]]);
  // 실제 활동은 가입 다음날(D1 윈도우)에 있었지만, 조회 기간(from)이 그보다 훨씬 뒤라
  // period-bound 쿼리로는 이 활동 자체를 가져오지 못한다.
  const allTimePoints = [{ unitId: "child-old", occurredAt: "2026-01-02T01:00:00Z" }];
  const periodBoundPoints = allTimePoints.filter((point) => Date.parse(point.occurredAt) >= Date.parse("2026-08-04T00:00:00Z"));
  assert.equal(periodBoundPoints.length, 0);
  const brokenResult = buildActivityRetention(periodBoundPoints, "2026-08-10", cohortDates);
  assert.equal(brokenResult.d1.rate, 0);
  const fixedResult = buildActivityRetention(allTimePoints, "2026-08-10", cohortDates);
  assert.equal(fixedResult.d1.rate, 100);
});

test("계측 시작 이전 가입 코호트를 분모에서 제외하면 거짓 0% 대신 accumulating을 보고한다 (R-2 회귀)", () => {
  const measuredFrom = "2026-08-10";
  const allCohorts = new Map([
    ["child-pre-instrumentation", "2026-07-01"],
    ["child-post-instrumentation", "2026-08-10"],
  ]);
  // 계측 이전 가입자는 방문 이벤트가 기록될 방법이 없었으므로 분모에서 제외해야 한다.
  const eligibleCohorts = new Map([...allCohorts].filter(([, date]) => date >= measuredFrom));
  const noVisits: { unitId: string; occurredAt: string }[] = [];
  const buggyResult = buildActivityRetention(noVisits, "2026-08-10", allCohorts);
  assert.equal(buggyResult.d1.rate, 0);
  assert.equal(buggyResult.d1.status, "ready");
  const fixedResult = buildActivityRetention(noVisits, "2026-08-10", eligibleCohorts);
  assert.equal(fixedResult.d1.status, "accumulating");
  assert.equal(fixedResult.d1.rate, null);
});

test("fetchAllAnalyticsRows는 maxRows 안전 상한을 초과하면 조용히 전량을 읽지 않고 즉시 에러를 던진다 (R-3 회귀)", async () => {
  const source = Array.from({ length: 2_500 }, (_, index) => ({ id: index, occurred_at: "2026-08-10T00:00:00.000Z" }));
  let pagesRead = 0;
  const factory = () => {
    const query = {
      order() { return query; },
      range(from: number, to: number) {
        pagesRead += 1;
        return Promise.resolve({ data: source.slice(from, to + 1), error: null });
      },
    };
    return query;
  };
  await assert.rejects(
    () => fetchAllAnalyticsRows<{ id: number; occurred_at: string }>(factory, { column: "occurred_at", uniqueColumn: "id" }, 1000, 1500),
    /안전 상한/,
  );
  assert.equal(pagesRead, 2);
});

test("신규 분석 코드는 deprecated daily_reports.viewed_at와 last_sign_in_at를 조회하지 않는다", async () => {
  const files = [
    "app/api/admin/analytics/activity-usage/route.ts",
    "app/api/admin/analytics/retention-activity/route.ts",
    "app/api/admin/analytics/retention-visit/route.ts",
    "app/api/admin/analytics/reports-funnel/route.ts",
    "app/api/admin/analytics/pipeline/route.ts",
    "app/api/admin/analytics/families/route.ts",
    "app/api/admin/analytics/product-value/route.ts",
    "app/api/admin/analytics/visits/route.ts",
  ];
  const source = (await Promise.allSettled(files.map((file) => readFile(file, "utf8"))))
    .map((result) => result.status === "fulfilled" ? result.value : "")
    .join("\n");
  assert.equal(source.includes("daily_reports.viewed_at"), false);
  assert.equal(source.includes("last_sign_in_at"), false);
  assert.equal(source.includes("Promise.all("), false);
  assert.match(source, /report_views/);
  assert.match(source, /app_session_start/);
  const sharedSource = await readFile("lib/admin/analyticsPhase2.ts", "utf8");
  assert.match(sharedSource, /getTestFamilyIds/);
  assert.match(sharedSource, /acquisition_links/);
  assert.match(sharedSource, /parent_attributions/);
});
