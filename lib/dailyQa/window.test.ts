import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveDailyQaWindow } from "./window";

test("019 §3-18: 실행 시점 기준 직전 24시간이다", () => {
  // 2026-08-20 02:00 KST = 2026-08-19 17:00 UTC
  const w = resolveDailyQaWindow("2026-08-19T17:00:00.000Z");
  assert.equal(w.windowEnd, "2026-08-19T17:00:00.000Z");
  assert.equal(w.windowStart, "2026-08-18T17:00:00.000Z");
});

test("019 §3-18: businessDate 는 window_end 의 KST 날짜다", () => {
  // 2026-08-19 17:00 UTC = 2026-08-20 02:00 KST
  assert.equal(resolveDailyQaWindow("2026-08-19T17:00:00.000Z").businessDate, "2026-08-20");
});

test("019 §3-21: 같은 시간대면 실행 초가 달라도 같은 execution key 다", () => {
  // 크론이 몇 초에 돌든, 관리자가 그 사이에 수동 실행하든 같은 Run 으로 묶여야 한다.
  const a = resolveDailyQaWindow("2026-08-19T17:00:03.000Z");
  const b = resolveDailyQaWindow("2026-08-19T17:47:59.999Z");
  assert.equal(a.executionKey, b.executionKey);
  assert.equal(a.windowStart, b.windowStart);
});

test("019 §3-21: 다른 시간대면 다른 execution key 다", () => {
  const a = resolveDailyQaWindow("2026-08-19T17:00:00.000Z");
  const b = resolveDailyQaWindow("2026-08-19T18:00:00.000Z");
  assert.notEqual(a.executionKey, b.executionKey);
});

test("잘못된 시각은 조용히 넘어가지 않는다", () => {
  assert.throws(() => resolveDailyQaWindow("not-a-date"));
});
