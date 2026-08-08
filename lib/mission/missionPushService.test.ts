import test from "node:test";
import assert from "node:assert/strict";
import { isRecentAdminTest, missionPushTemplate } from "./missionPushService";

test("미션 1과 2는 정기 발송과 동일한 제목·round_type을 사용한다", () => {
  assert.deepEqual(missionPushTemplate(1), {
    roundType: "round1_day",
    title: "미션 시작 시간이야!",
    body: "케이와 함께 오늘의 미션을 시작해 볼까요?",
    url: "/child/missions",
  });
  assert.deepEqual(missionPushTemplate(2), {
    roundType: "round2_night",
    title: "저녁 미션 시작 시간이야!",
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
