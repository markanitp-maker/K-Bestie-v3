import type { SupabaseClient } from "@supabase/supabase-js";

import {
  countSatisfiedGoals,
  getCompletionThreshold,
  type ConversationGoal,
} from "@/lib/mission-v3/goalEngine";

// 마스터 지시서(requests/073-...-master-request.md §16, 439~465행): "미션 시작
// 보상은 없다." Mission 정상 완료(Goal 3/4 이상) 시에만 지급하는 단일 reward_type만
// 존재한다.
export const MISSION_V3_REWARD_TYPES = ["mission_v3_complete"] as const;

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
 * `reason` values intentionally match the RPC's return values exactly (no
 * boredom-specific wording) so a TS pre-check rejection and a DB-side
 * rejection are indistinguishable to callers — the DB recount is the
 * authoritative source and has no notion of "boredom" as a stored fact.
 */
export const evaluateMissionV3RewardEligibility = (input: {
  goals: ConversationGoal[];
}): MissionV3RewardEligibility => {
  const satisfiedGoalCount = countSatisfiedGoals(input.goals);

  // 후보 부족(쿨다운 등)으로 Goal이 CONVERSATION_GOAL_COUNT보다 적게 생성될 수 있다.
  // 정확히 일치를 요구하면 그런 세션은 완료해도 보상이 안 나간다 — 최소 1개만 확인한다.
  if (input.goals.length === 0) {
    return { eligible: false, reason: "goals_not_initialized", satisfiedGoalCount };
  }

  // 완료 기준은 goalEngine이 실제 생성된 Goal 수를 반영해 보정한 값을 쓴다.
  if (satisfiedGoalCount < getCompletionThreshold(input.goals)) {
    return { eligible: false, reason: "goal_threshold_not_met", satisfiedGoalCount };
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
  goals: ConversationGoal[];
}): Promise<MissionV3RewardResult> => {
  const rewardType: MissionV3RewardType = "mission_v3_complete";

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
      rewardType,
      businessDate: input.businessDate,
    };
  }

  const { data, error } = await input.db.rpc("award_mission_v3_reward", {
    p_child_id: input.childId,
    p_business_date: input.businessDate,
    p_reward_type: rewardType,
    p_source_session_id: input.sourceSessionId,
  });
  if (error) {
    throw new Error(`Mission v3 보상 지급 실패: ${error.message}`);
  }

  const row: unknown = Array.isArray(data) ? data[0] : data;
  if (!isMissionV3RewardRpcRow(row)) {
    throw new Error("Mission v3 보상 RPC 응답 형식이 올바르지 않습니다.");
  }
  if (row.applied_reward_type !== rewardType
      || row.applied_business_date !== input.businessDate) {
    throw new Error("Mission v3 보상 RPC가 요청과 다른 멱등 키를 반환했습니다.");
  }

  return {
    rewarded: row.rewarded,
    eligible: row.eligible,
    reason: row.reason,
    satisfiedGoalCount: row.satisfied_goal_count,
    rewardType,
    businessDate: input.businessDate,
  };
};
