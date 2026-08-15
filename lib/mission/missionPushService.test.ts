import test from "node:test";
import assert from "node:assert/strict";
import { isRecentAdminTest, missionPushTemplate, shouldDeactivateMissionPushSubscription } from "./missionPushService";

test("하루 1회 정책에서 미션 1·2 모두 동일 제목을 쓰고 round_type은 보존한다", () => {
  assert.deepEqual(missionPushTemplate(1), {
    roundType: "round1_day",
    title: "미션 시작 시간이야!",
    body: "케이와 함께 오늘의 미션을 시작해 볼까요?",
    url: "/child/missions",
  });
  assert.deepEqual(missionPushTemplate(2), {
    roundType: "round2_night",
    title: "미션 시작 시간이야!",
    body: "케이와 함께 오늘의 미션을 시작해 볼까요?",
    url: "/child/missions",
  });
});

test("관리자 테스트는 30초 이내 동일 요청을 중복으로 판정한다", () => {
  const now = Date.parse("2026-08-08T12:00:00.000Z");
  assert.equal(isRecentAdminTest("2026-08-08T11:59:45.000Z", now), true);
  assert.equal(isRecentAdminTest("2026-08-08T11:59:29.999Z", now), false);
  assert.equal(isRecentAdminTest("invalid", now), false);
});

test("403은 구독을 유지하고 404/410만 stale 구독으로 비활성화한다", () => {
  assert.equal(shouldDeactivateMissionPushSubscription(403), false);
  assert.equal(shouldDeactivateMissionPushSubscription(404), true);
  assert.equal(shouldDeactivateMissionPushSubscription(410), true);
});
