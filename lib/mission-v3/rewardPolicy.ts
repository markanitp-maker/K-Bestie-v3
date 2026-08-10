import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CONVERSATION_GOAL_COUNT,
  countSatisfiedGoals,
  type ConversationGoal,
} from "@/lib/mission-v3/goalEngine";

export const MISSION_V3_REWARD_TYPES = [
  "mission_v3_start",
  "mission_v3_complete",
] as const;

export type MissionV3RewardType = typeof MISSION_V3_REWARD_TYPES[number];

export interface MissionV3RewardEligibility {
  eligible: boolean;
  reason: string;
  satisfiedGoalCount: number;
}

export interface MissionV3RewardResult extends MissionV3RewardEligibility {
  rewarded: boolean;
  rewardType: MissionV3RewardType;
  businessDate: string;
}

interface MissionV3RewardRpcRow {
  rewarded: boolean;
  eligible: boolean;
  reason: string;
  applied_reward_type: string;
  applied_business_date: string;
  satisfied_goal_count: number;
}

const isMissionV3RewardRpcRow = (value: unknown): value is MissionV3RewardRpcRow => {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.rewarded === "boolean"
    && typeof row.eligible === "boolean"
    && typeof row.reason === "string"
    && typeof row.applied_reward_type === "string"
    && typeof row.applied_business_date === "string"
    && typeof row.satisfied_goal_count === "number";
};

const isBusinessDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/**
 * Fast caller-side policy check. The SQL RPC independently recounts persisted
 * goals and validates the daily_single session before touching the ledger.
 */
export const evaluateMissionV3RewardEligibility = (input: {
  rewardType: MissionV3RewardType;
  goals: ConversationGoal[];
  boredomEarlyExit?: boolean;
}): MissionV3RewardEligibility => {
  const satisfiedGoalCount = countSatisfiedGoals(input.goals);

  if (input.goals.length !== CONVERSATION_GOAL_COUNT) {
    return { eligible: false, reason: "goals_not_initialized", satisfiedGoalCount };
  }

  if (input.rewardType === "mission_v3_start") {
    return { eligible: true, reason: "eligible", satisfiedGoalCount };
  }

  if (satisfiedGoalCount < 3) {
    return {
      eligible: false,
      reason: input.boredomEarlyExit
        ? "boredom_goal_threshold_not_met"
        : "goal_threshold_not_met",
      satisfiedGoalCount,
    };
  }

  return { eligible: true, reason: "eligible", satisfiedGoalCount };
};

/**
 * Awards one Mission v3 ledger row through the authoritative atomic RPC.
 * Repeating this call with childId+businessDate+rewardType returns a no-op.
 */
export const awardMissionV3Reward = async (input: {
  db: SupabaseClient;
  childId: string;
  sourceSessionId: string;
  businessDate: string;
  rewardType: MissionV3RewardType;
  goals: ConversationGoal[];
  boredomEarlyExit?: boolean;
}): Promise<MissionV3RewardResult> => {
  if (!input.childId.trim() || !input.sourceSessionId.trim()) {
    throw new Error("아이와 미션 세션 식별자는 비어 있을 수 없습니다.");
  }
  if (!isBusinessDate(input.businessDate)) {
    throw new Error("미션 보상 기준일은 YYYY-MM-DD 형식의 유효한 날짜여야 합니다.");
  }

  const eligibility = evaluateMissionV3RewardEligibility(input);
  if (!eligibility.eligible) {
    return {
      ...eligibility,
      rewarded: false,
      rewardType: input.rewardType,
      businessDate: input.businessDate,
    };
  }

  const { data, error } = await input.db.rpc("award_mission_v3_reward", {
    p_child_id: input.childId,
    p_business_date: input.businessDate,
    p_reward_type: input.rewardType,
    p_source_session_id: input.sourceSessionId,
  });
  if (error) {
    throw new Error(`Mission v3 보상 지급 실패: ${error.message}`);
  }

  const row: unknown = Array.isArray(data) ? data[0] : data;
  if (!isMissionV3RewardRpcRow(row)) {
    throw new Error("Mission v3 보상 RPC 응답 형식이 올바르지 않습니다.");
  }
  if (row.applied_reward_type !== input.rewardType
      || row.applied_business_date !== input.businessDate) {
    throw new Error("Mission v3 보상 RPC가 요청과 다른 멱등 키를 반환했습니다.");
  }

  return {
    rewarded: row.rewarded,
    eligible: row.eligible,
    reason: row.reason,
    satisfiedGoalCount: row.satisfied_goal_count,
    rewardType: input.rewardType,
    businessDate: input.businessDate,
  };
};
