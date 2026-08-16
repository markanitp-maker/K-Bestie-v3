import test from "node:test";
import assert from "node:assert/strict";
import { isRecentAdminTest, missionPushTemplate, shouldDeactivateMissionPushSubscription } from "./missionPushService";

test("아직 시작하지 않은 아이에게는 시작 문구를 보낸다", () => {
  const t = missionPushTemplate(2, "NOT_STARTED");
  assert.equal(t.title, "오늘의 미션 시간이야!");
  assert.equal(t.body, "케이와 오늘 이야기를 시작해 볼까요?");
  assert.equal(t.url, "/child/missions");
});

test("진행 중인 아이에게는 이어하기 문구를 보낸다", () => {
  const t = missionPushTemplate(2, "IN_PROGRESS");
  assert.equal(t.title, "오늘의 미션을 이어가 볼까?");
  assert.equal(t.body, "케이가 기다리고 있어요.");
});

test("사용자 노출 문구에 V2 라운드 개념을 쓰지 않는다(079 §5 금지 목록)", () => {
  // "1차/2차/낮/저녁 미션"은 하루 2회 정책 잔재다. Mission v3는 하루 1회다.
  const forbidden = ["1차", "2차", "낮 미션", "저녁", "round1", "round2"];
  for (const state of ["NOT_STARTED", "IN_PROGRESS"] as const) {
    for (const missionType of [1, 2] as const) {
      const t = missionPushTemplate(missionType, state);
      const shown = `${t.title} ${t.body}`;
      for (const word of forbidden) {
        assert.equal(shown.includes(word), false, `${state}/${missionType} 문구에 "${word}"가 있으면 안 된다: ${shown}`);
      }
    }
  }
});

test("round_type은 기존 로그·중복방지 키이므로 바꾸지 않는다", () => {
  // 문구만 V3화하고 내부 식별자는 유지한다. 바꾸면 과거 발송 이력과 어긋난다.
  assert.equal(missionPushTemplate(1, "NOT_STARTED").roundType, "round1_day");
  assert.equal(missionPushTemplate(2, "IN_PROGRESS").roundType, "round2_night");
});

test("기본값은 시작 문구다", () => {
  assert.equal(missionPushTemplate(2).title, "오늘의 미션 시간이야!");
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
