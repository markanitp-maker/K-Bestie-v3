import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildActivityRetention,
  fetchAllAnalyticsRows,
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

test("페이지 집계는 1000행 경계에서 다음 페이지를 이어 읽고 가족 UUID는 opaque ref로 바꾼다", async () => {
  const pages = [[1, 2], [3]];
  const rows = await fetchAllAnalyticsRows<number>((from) => Promise.resolve({ data: pages[from / 2] ?? [], error: null }), 2);
  assert.deepEqual(rows, [1, 2, 3]);
  const raw = "123e4567-e89b-12d3-a456-426614174000";
  const ref = stableAnalyticsRef(raw);
  assert.equal(ref.length, 16);
  assert.equal(ref.includes(raw), false);
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
