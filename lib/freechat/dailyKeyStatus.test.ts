import test from "node:test";
import assert from "node:assert/strict";

import {
  FREECHAT_DAILY_KEY_REWARD_TYPE,
  buildFreechatDailyKeyStatus,
  markFreechatDailyKeyEarned,
  parseFreechatDailyKeyStatus,
} from "./dailyKeyStatus";

// 요청서 011 §7 — 판정은 child_id + reward_type='freechat_daily_engagement' + KST business_date 뿐이다.

test("조회 대상 reward_type 은 자유대화 일일 보상 하나뿐이다", () => {
  assert.equal(FREECHAT_DAILY_KEY_REWARD_TYPE, "freechat_daily_engagement");
});

test("오늘 지급 행이 없으면 미획득이고 rewardAmount 는 0 이다", () => {
  const status = buildFreechatDailyKeyStatus(null, "2026-08-19");
  assert.deepEqual(status, {
    earnedToday: false,
    earnedAt: null,
    businessDate: "2026-08-19",
    rewardAmount: 0,
  });
  // undefined(조회 결과 없음)도 같게 다룬다.
  assert.deepEqual(buildFreechatDailyKeyStatus(undefined, "2026-08-19"), status);
});

test("오늘 지급 행이 있으면 획득이고 rewardAmount 는 1 이다", () => {
  const status = buildFreechatDailyKeyStatus(
    { earned_at: "2026-08-19T01:23:45.000Z" },
    "2026-08-19"
  );
  assert.deepEqual(status, {
    earnedToday: true,
    earnedAt: "2026-08-19T01:23:45.000Z",
    businessDate: "2026-08-19",
    rewardAmount: 1,
  });
});

test("earned_at 이 비어 있어도 행이 있으면 획득으로 본다", () => {
  const status = buildFreechatDailyKeyStatus({ earned_at: null }, "2026-08-19");
  assert.equal(status.earnedToday, true);
  assert.equal(status.earnedAt, null);
  assert.equal(status.rewardAmount, 1);
});

test("지급 직후 즉시 갱신은 이전 businessDate 를 유지한다", () => {
  const before = buildFreechatDailyKeyStatus(null, "2026-08-19");
  const after = markFreechatDailyKeyEarned(before, "2026-08-19", "2026-08-19T02:00:00.000Z");
  assert.deepEqual(after, {
    earnedToday: true,
    earnedAt: "2026-08-19T02:00:00.000Z",
    businessDate: "2026-08-19",
    rewardAmount: 1,
  });
});

test("이전 상태를 모르는 채 지급되면 서버가 알려준 businessDate 를 쓴다", () => {
  const after = markFreechatDailyKeyEarned(null, "2026-08-19", "2026-08-19T02:00:00.000Z");
  assert.equal(after.businessDate, "2026-08-19");
  assert.equal(after.earnedToday, true);
});

test("서버 응답 계약을 검증해서 읽는다", () => {
  assert.deepEqual(
    parseFreechatDailyKeyStatus({
      earnedToday: true,
      earnedAt: "2026-08-19T01:00:00.000Z",
      businessDate: "2026-08-19",
      rewardAmount: 1,
    }),
    {
      earnedToday: true,
      earnedAt: "2026-08-19T01:00:00.000Z",
      businessDate: "2026-08-19",
      rewardAmount: 1,
    }
  );
  assert.deepEqual(
    parseFreechatDailyKeyStatus({
      earnedToday: false,
      earnedAt: null,
      businessDate: "2026-08-19",
      rewardAmount: 0,
    }),
    { earnedToday: false, earnedAt: null, businessDate: "2026-08-19", rewardAmount: 0 }
  );
});

test("형식이 어긋난 응답은 null 이며(미획득으로 단정하지 않는다)", () => {
  const badCases: unknown[] = [
    null,
    undefined,
    "earned",
    [],
    {},
    { earnedToday: "true", businessDate: "2026-08-19", rewardAmount: 0 },
    { earnedToday: true, businessDate: "", rewardAmount: 1 },
    { earnedToday: true, businessDate: "2026-08-19", rewardAmount: "1" },
    { earnedToday: true, businessDate: "2026-08-19", rewardAmount: Number.NaN },
    { earnedToday: true, earnedAt: 12345, businessDate: "2026-08-19", rewardAmount: 1 },
  ];
  for (const value of badCases) {
    assert.equal(
      parseFreechatDailyKeyStatus(value),
      null,
      `${JSON.stringify(value)} 는 null 이어야 한다`
    );
  }
});

test("earnedAt 이 없는(생략된) 응답도 읽을 수 있다", () => {
  const parsed = parseFreechatDailyKeyStatus({
    earnedToday: false,
    businessDate: "2026-08-19",
    rewardAmount: 0,
  });
  assert.equal(parsed?.earnedAt, null);
  assert.equal(parsed?.earnedToday, false);
});
