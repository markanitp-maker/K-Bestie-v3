import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboardCardInsights, DASHBOARD_CARD_FIELDS } from "./dashboardCardInsights";

const now = new Date("2026-08-07T12:00:00+09:00");

test("새 정보가 있는 영역만 최신 값과 business_date로 갱신한다", () => {
  const insights = buildDashboardCardInsights([
    {
      business_date: "2026-08-06",
      dashboard_cards: { peer_friendship: "새 친구와 놀이", study_concerns: "" },
    },
    {
      business_date: "2026-08-05",
      dashboard_cards: { peer_friendship: "과거 친구 이야기", study_concerns: "수학 문제 해결" },
    },
  ], now);

  assert.equal(insights.peer_friendship.value, "새 친구와 놀이");
  assert.equal(insights.peer_friendship.last_observed_at, "2026-08-06");
  assert.equal(insights.study_concerns.value, "수학 문제 해결");
  assert.equal(insights.study_concerns.last_observed_at, "2026-08-05");
});

test("최신 리포트의 빈 값은 과거 최근 유효값과 관찰일을 유지한다", () => {
  const insights = buildDashboardCardInsights([
    { business_date: "2026-08-06", dashboard_cards: { teacher_adults: "" } },
    { business_date: "2026-07-20", dashboard_cards: { teacher_adults: "선생님께 칭찬" } },
  ], now);

  assert.equal(insights.teacher_adults.value, "선생님께 칭찬");
  assert.equal(insights.teacher_adults.last_observed_at, "2026-07-20");
});

test("한 번도 유효값이 없는 영역만 null로 남긴다", () => {
  const insights = buildDashboardCardInsights([
    { business_date: "2026-08-06", dashboard_cards: { recurring_stories: "" } },
  ], now);

  assert.equal(insights.recurring_stories.value, null);
  assert.equal(insights.recurring_stories.last_observed_at, null);
  assert.deepEqual(Object.keys(insights), [...DASHBOARD_CARD_FIELDS]);
});

test("recent_count도 긴 본문이 아닌 dashboard_cards 유효 관찰만 센다", () => {
  const insights = buildDashboardCardInsights([
    { business_date: "2026-08-06", dashboard_cards: { emotion_hint: "즐겁게 캐릭터 제작" } },
    { business_date: "2026-08-04", dashboard_cards: { emotion_hint: "칭찬받아 기쁨" } },
    { business_date: "2026-07-20", dashboard_cards: { emotion_hint: "옛날 관찰" } },
  ], now);

  assert.equal(insights.emotion_hint.recent_count, 2);
});
