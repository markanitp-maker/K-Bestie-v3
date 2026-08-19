import assert from "node:assert/strict";
import { test } from "node:test";

import { aggregateDetections } from "./aggregate";
import { DAILY_QA_EXCERPT_MAX_CHARS, DAILY_QA_MAX_EXAMPLES } from "./taxonomy";
import type { DailyQaDetection } from "./ruleDetectors";

function det(over: Partial<DailyQaDetection> = {}): DailyQaDetection {
  return {
    taxonomyCode: "LLM_FALLBACK",
    sessionId: "s1",
    childId: "c1",
    messageId: "m1",
    excerpt: "응, 듣고 있어. 더 얘기해줄래?",
    occurredAt: "2026-08-19T01:00:00.000Z",
    ...over,
  };
}

test("019: taxonomy 별로 한 줄로 묶고 건수·아이수·세션수를 센다", () => {
  const drafts = aggregateDetections([
    det({ sessionId: "s1", childId: "c1", messageId: "m1" }),
    det({ sessionId: "s2", childId: "c2", messageId: "m2" }),
    det({ sessionId: "s2", childId: "c2", messageId: "m3" }),
    det({ taxonomyCode: "PARDON_REPEAT", sessionId: "s3", childId: "c3", messageId: "m4" }),
  ]);
  assert.equal(drafts.length, 2);
  const fallback = drafts.find((d) => d.taxonomyCode === "LLM_FALLBACK")!;
  assert.equal(fallback.eventCount, 3);
  assert.equal(fallback.affectedChildrenCount, 2);
  assert.equal(fallback.affectedSessionsCount, 2);
});

test("019 §3-13: 대표 사례는 서로 다른 세션을 우선한다", () => {
  // 같은 세션 3건을 그대로 보여주면 한 아이 문제인지 여러 아이 문제인지 구분이 안 된다.
  const drafts = aggregateDetections([
    det({ sessionId: "s1", messageId: "m1", occurredAt: "2026-08-19T01:00:00.000Z" }),
    det({ sessionId: "s1", messageId: "m2", occurredAt: "2026-08-19T01:01:00.000Z" }),
    det({ sessionId: "s1", messageId: "m3", occurredAt: "2026-08-19T01:02:00.000Z" }),
    det({ sessionId: "s2", messageId: "m4", occurredAt: "2026-08-19T01:03:00.000Z" }),
  ]);
  const sessions = drafts[0].representativeExamples.map((e) => e.sessionId);
  assert.ok(sessions.includes("s2"), "다른 세션 사례가 대표에서 빠졌다");
});

test("019 §3-13: 대표 사례는 최대 3개, excerpt 는 200자 이내", () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    det({ sessionId: `s${i}`, messageId: `m${i}`, excerpt: "가".repeat(500) })
  );
  const drafts = aggregateDetections(many);
  assert.equal(drafts[0].representativeExamples.length, DAILY_QA_MAX_EXAMPLES);
  for (const example of drafts[0].representativeExamples) {
    assert.ok(example.excerpt.length <= DAILY_QA_EXCERPT_MAX_CHARS);
  }
  // 원문을 복제하지 않는다 — id 는 전부 남기되 excerpt 는 3개뿐이다.
  assert.equal(drafts[0].messageIds.length, 10);
});

test("019: 모르는 taxonomy 코드도 버리지 않고 LOW 로 올린다", () => {
  const drafts = aggregateDetections([det({ taxonomyCode: "SOME_NEW_CODE" })]);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].severity, "LOW");
  assert.equal(drafts[0].title, "SOME_NEW_CODE");
});

test("019: 첫/마지막 발생 시각은 시간순 양 끝이다", () => {
  const drafts = aggregateDetections([
    det({ messageId: "m2", occurredAt: "2026-08-19T05:00:00.000Z" }),
    det({ messageId: "m1", occurredAt: "2026-08-19T01:00:00.000Z" }),
  ]);
  assert.equal(drafts[0].firstDetectedAt, "2026-08-19T01:00:00.000Z");
  assert.equal(drafts[0].lastDetectedAt, "2026-08-19T05:00:00.000Z");
});
