export const FREECHAT_DAILY_REWARD_TYPE = "freechat_daily_engagement" as const;

export interface FreechatDailyReward {
  earned: boolean;
  eligible: boolean;
  reason: string;
  amount: number;
  balance: number | null;
  rewardType: typeof FREECHAT_DAILY_REWARD_TYPE;
  businessDate: string;
  eventCount: number | null;
}

export interface FreechatPauseSuccessResponse {
  ok: true;
  reward: FreechatDailyReward;
}

export interface FreechatRewardModalContent {
  title: string;
  description: string;
  awarded: true;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

export function parseFreechatPauseSuccess(value: unknown): FreechatPauseSuccessResponse | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.reward)) return null;

  const reward = value.reward;
  if (
    typeof reward.earned !== "boolean"
    || typeof reward.eligible !== "boolean"
    || typeof reward.reason !== "string"
    || typeof reward.amount !== "number"
    || !Number.isInteger(reward.amount)
    || reward.amount < 0
    || (reward.balance !== null && (
      typeof reward.balance !== "number"
      || !Number.isInteger(reward.balance)
      || reward.balance < 0
    ))
    || reward.rewardType !== FREECHAT_DAILY_REWARD_TYPE
    || typeof reward.businessDate !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(reward.businessDate)
    || (reward.eventCount !== null && (
      typeof reward.eventCount !== "number" || !Number.isInteger(reward.eventCount)
    ))
  ) {
    return null;
  }

  return {
    ok: true,
    reward: {
      earned: reward.earned,
      eligible: reward.eligible,
      reason: reward.reason,
      amount: reward.amount,
      balance: reward.balance,
      rewardType: FREECHAT_DAILY_REWARD_TYPE,
      businessDate: reward.businessDate,
      eventCount: reward.eventCount,
    },
  };
}

export function getFreechatRewardModalContent(
  reward: FreechatDailyReward
): FreechatRewardModalContent | null {
  if (!reward.earned || reward.amount !== 1) return null;

  return {
    title: "황금열쇠를 받았어요",
    description: reward.balance === null
      ? "오늘 자유대화에 참여해서 받았어."
      : `오늘 자유대화에 참여해서 받았어. 지금 황금열쇠 ${reward.balance}개를 모았어.`,
    awarded: true,
  };
}
