import assert from "node:assert/strict";
import test from "node:test";

import {
  FREECHAT_DAILY_REWARD_TYPE,
  getFreechatRewardModalContent,
  parseFreechatPauseSuccess,
} from "./dailyEngagementReward.ts";

const rewardedPayload = {
  ok: true,
  reward: {
    earned: true,
    eligible: true,
    reason: "rewarded",
    amount: 1,
    balance: 7,
    rewardType: FREECHAT_DAILY_REWARD_TYPE,
    businessDate: "2026-08-14",
    eventCount: 3,
  },
};

test("실제 지급 응답만 자유대화 황금열쇠 모달로 변환한다", () => {
  const parsed = parseFreechatPauseSuccess(rewardedPayload);
  assert.ok(parsed);
  assert.deepEqual(getFreechatRewardModalContent(parsed.reward), {
    title: "황금열쇠를 받았어요",
    description: "오늘 자유대화에 참여해서 받았어. 지금 황금열쇠 7개를 모았어.",
    awarded: true,
  });
});

test("같은 KST 날짜 이미 지급 응답은 획득 모달을 다시 열지 않는다", () => {
  const parsed = parseFreechatPauseSuccess({
    ...rewardedPayload,
    reward: {
      ...rewardedPayload.reward,
      earned: false,
      amount: 0,
      reason: "already_rewarded_today",
    },
  });
  assert.ok(parsed);
  assert.equal(getFreechatRewardModalContent(parsed.reward), null);
});

test("비적격 또는 활성 잔액 상한 응답은 획득 모달을 열지 않는다", () => {
  for (const reason of ["session_too_short", "insufficient_meaningful_turns", "active_balance_limit"]) {
    const parsed = parseFreechatPauseSuccess({
      ...rewardedPayload,
      reward: {
        ...rewardedPayload.reward,
        earned: false,
        eligible: reason === "active_balance_limit",
        amount: 0,
        reason,
      },
    });
    assert.ok(parsed);
    assert.equal(getFreechatRewardModalContent(parsed.reward), null);
  }
});

test("누락되거나 위조된 reward 계약은 처리하지 않는다", () => {
  assert.equal(parseFreechatPauseSuccess({ ok: true }), null);
  assert.equal(parseFreechatPauseSuccess({
    ...rewardedPayload,
    reward: { ...rewardedPayload.reward, rewardType: "mission_complete" },
  }), null);
  assert.equal(parseFreechatPauseSuccess({
    ...rewardedPayload,
    reward: { ...rewardedPayload.reward, balance: -1 },
  }), null);
});

test("잔액 조회가 실패해도 실제 지급 모달은 유지한다", () => {
  const parsed = parseFreechatPauseSuccess({
    ...rewardedPayload,
    reward: { ...rewardedPayload.reward, balance: null },
  });
  assert.ok(parsed);
  assert.deepEqual(getFreechatRewardModalContent(parsed.reward), {
    title: "황금열쇠를 받았어요",
    description: "오늘 자유대화에 참여해서 받았어.",
    awarded: true,
  });
});
