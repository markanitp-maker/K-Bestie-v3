import test from "node:test";
import assert from "node:assert/strict";
import { buildOperationsHref, parseOperationsLocation } from "./operationsConsole";

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
