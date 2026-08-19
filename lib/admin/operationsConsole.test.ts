import test from "node:test";
import assert from "node:assert/strict";
import { buildOperationsHref, parseOperationsLocation, resolveAcquisitionPeriodRange } from "./operationsConsole";

test("defaults invalid operations query values safely", () => {
  const state = parseOperationsLocation(new URLSearchParams("tab=unknown&sub=nope&period=year&includeTestAccounts=1"));
  assert.equal(state.tab, "push");
  assert.equal(state.sub, "dashboard");
  assert.equal(state.acquisition.period, "30d");
  assert.equal(state.acquisition.includeTestAccounts, false);
});

test("round-trips acquisition shared state between sub-tabs", () => {
  const initial = parseOperationsLocation(new URLSearchParams("tab=acquisition&sub=links&period=14d&attribution=first&includeTestAccounts=true&channel=kakao"));
  const href = buildOperationsHref(initial);
  const parsed = parseOperationsLocation(new URL(href, "https://app.k-bestie.com").searchParams);
  assert.deepEqual(parsed, initial);
});

test("does not retain acquisition-only state on unrelated tabs", () => {
  const href = buildOperationsHref({
    tab: "trash",
    sub: "links",
    acquisition: { period: "custom", attribution: "first", includeTestAccounts: true, channelFilter: "kakao", startDate: "2026-08-01", endDate: "2026-08-08" },
  });
  assert.equal(href, "/admin/operations?tab=trash");
});

test("acquisition periods use inclusive KST calendar boundaries", () => {
  const now = new Date("2026-08-08T15:30:00.000Z"); // 2026-08-09 00:30 KST
  assert.deepEqual(resolveAcquisitionPeriodRange({ period: "today", now }), {
    fromIso: "2026-08-09T00:00:00.000+09:00",
    toIso: "2026-08-09T23:59:59.999+09:00",
    startDate: "2026-08-09",
    endDate: "2026-08-09",
  });
  assert.equal(resolveAcquisitionPeriodRange({ period: "7d", now }).startDate, "2026-08-03");
  assert.equal(resolveAcquisitionPeriodRange({ period: "14d", now }).startDate, "2026-07-27");
  assert.equal(resolveAcquisitionPeriodRange({ period: "30d", now }).startDate, "2026-07-11");
  assert.equal(resolveAcquisitionPeriodRange({ period: "month", now }).startDate, "2026-08-01");
  assert.deepEqual(resolveAcquisitionPeriodRange({ period: "last_month", now }), {
    fromIso: "2026-07-01T00:00:00.000+09:00",
    toIso: "2026-07-31T23:59:59.999+09:00",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  });
});

test("custom acquisition range rejects invalid or reversed dates", () => {
  assert.throws(() => resolveAcquisitionPeriodRange({ period: "custom", startDate: "2026-02-30", endDate: "2026-03-01" }));
  assert.throws(() => resolveAcquisitionPeriodRange({ period: "custom", startDate: "2026-08-10", endDate: "2026-08-09" }));
});

test("parses issues tab query parameter correctly", () => {
  const state = parseOperationsLocation(new URLSearchParams("tab=issues"));
  assert.equal(state.tab, "issues");
  const href = buildOperationsHref(state);
  assert.equal(href, "/admin/operations?tab=issues");
});

test("falls back to default push tab when unknown tab is provided", () => {
  const state = parseOperationsLocation(new URLSearchParams("tab=nonexistent_tab"));
  assert.equal(state.tab, "push");
});

