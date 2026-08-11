import assert from "node:assert/strict";
import test from "node:test";

import { calculateRelationshipCalendarStage } from "./calendarStage";

test("relationship_started_at이 없으면 calendar stage도 없다", () => {
  assert.equal(
    calculateRelationshipCalendarStage({ relationship_started_at: null }, new Date("2026-08-11T00:00:00Z")),
    null,
  );
});

test("Asia/Seoul 달력 날짜를 relationship_started_at 기준 W1~W4로 계산한다", () => {
  const relationshipStartedAt = "2026-08-01T14:59:59Z"; // 2026-08-01 23:59:59 KST

  const source = { relationship_started_at: relationshipStartedAt };
  assert.equal(calculateRelationshipCalendarStage(source, new Date("2026-08-07T14:59:59Z")), "W1");
  assert.equal(calculateRelationshipCalendarStage(source, new Date("2026-08-07T15:00:00Z")), "W2");
  assert.equal(calculateRelationshipCalendarStage(source, new Date("2026-08-14T15:00:00Z")), "W3");
  assert.equal(calculateRelationshipCalendarStage(source, new Date("2026-08-21T15:00:00Z")), "W4");
  assert.equal(calculateRelationshipCalendarStage(source, new Date("2027-08-21T15:00:00Z")), "W4");
});

test("잘못된 시각과 관계 시작 전 시각은 stage를 만들지 않는다", () => {
  assert.equal(
    calculateRelationshipCalendarStage({ relationship_started_at: "invalid" }, new Date("2026-08-11T00:00:00Z")),
    null,
  );
  assert.equal(
    calculateRelationshipCalendarStage(
      { relationship_started_at: "2026-08-12T00:00:00Z" },
      new Date("2026-08-11T00:00:00Z"),
    ),
    null,
  );
  assert.equal(
    calculateRelationshipCalendarStage(
      { relationship_started_at: "2026-08-12T08:00:00Z" }, // 2026-08-12 17:00 KST
      new Date("2026-08-12T04:00:00Z"), // 같은 KST 날짜의 13:00, 시작 4시간 전
    ),
    null,
  );
});
