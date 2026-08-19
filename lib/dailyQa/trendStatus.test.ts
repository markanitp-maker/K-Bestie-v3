import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveTrendStatus } from "./trendStatus";

const base = {
  eventCount: 0,
  prevEventCount: null as number | null,
  hadHistoryBeforeYesterday: false,
  analyzedSessions: 20,
  prevAnalyzedSessions: 20 as number | null,
};

test("019 §3-11: 이력 없이 오늘 처음 나면 NEW", () => {
  assert.equal(resolveTrendStatus({ ...base, eventCount: 3 }), "NEW");
});

test("019 §3-11: 어제도 오늘도 나면 ONGOING", () => {
  assert.equal(
    resolveTrendStatus({ ...base, eventCount: 4, prevEventCount: 5, hadHistoryBeforeYesterday: true }),
    "ONGOING"
  );
});

test("019 §3-11: 어제 0건인데 과거 이력이 있으면 RECURRED", () => {
  assert.equal(
    resolveTrendStatus({ ...base, eventCount: 2, prevEventCount: 0, hadHistoryBeforeYesterday: true }),
    "RECURRED"
  );
});

test("019 §3-11: 어제까지 났는데 오늘 0건이면 RESOLVED_CANDIDATE (FIXED 아님)", () => {
  assert.equal(
    resolveTrendStatus({ ...base, eventCount: 0, prevEventCount: 6, hadHistoryBeforeYesterday: true }),
    "RESOLVED_CANDIDATE"
  );
});

test("019 §3-12: 절대 건수가 아니라 세션당 발생률로 개선을 판정한다", () => {
  // 건수는 그대로 5건인데 분석 세션이 2배로 늘었다 → 발생률은 절반이다.
  assert.equal(
    resolveTrendStatus({
      eventCount: 5,
      prevEventCount: 5,
      hadHistoryBeforeYesterday: true,
      analyzedSessions: 100,
      prevAnalyzedSessions: 50,
    }),
    "IMPROVED"
  );
  // 반대로 건수가 줄었어도 세션이 더 많이 줄었으면 개선이 아니다.
  assert.equal(
    resolveTrendStatus({
      eventCount: 4,
      prevEventCount: 5,
      hadHistoryBeforeYesterday: true,
      analyzedSessions: 10,
      prevAnalyzedSessions: 50,
    }),
    "ONGOING"
  );
});

test("019 §3-12: 분모가 너무 작으면 비율을 쓰지 않고 건수로만 본다", () => {
  assert.equal(
    resolveTrendStatus({
      eventCount: 1,
      prevEventCount: 4,
      hadHistoryBeforeYesterday: true,
      analyzedSessions: 2,
      prevAnalyzedSessions: 2,
    }),
    "IMPROVED"
  );
  assert.equal(
    resolveTrendStatus({
      eventCount: 3,
      prevEventCount: 4,
      hadHistoryBeforeYesterday: true,
      analyzedSessions: 2,
      prevAnalyzedSessions: 2,
    }),
    "ONGOING"
  );
});
