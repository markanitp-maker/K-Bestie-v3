import type { RelationshipCalendarStage } from "./calendarStage";

export interface RelationshipStageThreshold {
  stage: "W2" | "W3" | "W4"; // W1은 진입 조건 없음(시작 단계)
  minConversationCount: number;
  minConversationDays: number;
  minUsableMemoryCount: number;
  minSharedMemoryCount: number;
  minRelationshipEventCount: number;
}

export interface RelationshipStageRuleSet {
  version: string; // 예: "v1"
  thresholds: RelationshipStageThreshold[];
}

/** effective_stage 판정에 쓰는 아이의 실제 활동 지표. */
export interface RelationshipStageMetrics {
  conversationCount: number;
  conversationDays: number;
  usableMemoryCount: number;
  sharedMemoryCount: number;
  relationshipEventCount: number;
}

export interface EffectiveStageResult {
  effectiveStage: RelationshipCalendarStage | null;
  ruleVersion: string;
  /** 어느 조건에서 막혔는지. 관측·디버깅용. */
  blockedBy: string | null;
}

export const DEFAULT_STAGE_RULE_SET: RelationshipStageRuleSet = {
  version: "v1",
  thresholds: [
    {
      stage: "W2",
      minConversationCount: 2,
      minConversationDays: 2,
      minUsableMemoryCount: 1,
      minSharedMemoryCount: 0,
      minRelationshipEventCount: 0,
    },
    {
      stage: "W3",
      minConversationCount: 5,
      minConversationDays: 4,
      minUsableMemoryCount: 3,
      minSharedMemoryCount: 1,
      minRelationshipEventCount: 1,
    },
    {
      stage: "W4",
      minConversationCount: 9,
      minConversationDays: 7,
      minUsableMemoryCount: 5,
      minSharedMemoryCount: 2,
      minRelationshipEventCount: 3,
    },
  ],
};

const STAGE_ORDER: Record<RelationshipCalendarStage, number> = {
  W1: 1,
  W2: 2,
  W3: 3,
  W4: 4,
};

const STAGE_FROM_ORDER: Record<number, RelationshipCalendarStage> = {
  1: "W1",
  2: "W2",
  3: "W3",
  4: "W4",
};

const PROGRESSION_STAGES: Array<"W2" | "W3" | "W4"> = ["W2", "W3", "W4"];

export function resolveEffectiveStage(input: {
  calendarStage: RelationshipCalendarStage | null;
  metrics: RelationshipStageMetrics;
  ruleSet?: RelationshipStageRuleSet;
  /** 이미 올라간 단계. V1은 자동 강등이 없으므로 여기보다 내려가지 않는다(§8). */
  currentEffectiveStage?: RelationshipCalendarStage | null;
}): EffectiveStageResult {
  const activeRuleSet = input.ruleSet ?? DEFAULT_STAGE_RULE_SET;

  if (input.calendarStage === null) {
    return {
      effectiveStage: null,
      ruleVersion: activeRuleSet.version,
      blockedBy: null,
    };
  }

  const maxCalendarLevel = STAGE_ORDER[input.calendarStage];
  if (!maxCalendarLevel) {
    return {
      effectiveStage: null,
      ruleVersion: activeRuleSet.version,
      blockedBy: null,
    };
  }

  const thresholdMap = new Map<"W2" | "W3" | "W4", RelationshipStageThreshold>();
  for (const threshold of activeRuleSet.thresholds) {
    thresholdMap.set(threshold.stage, threshold);
  }

  let calculatedLevel = 1; // W1은 기본 진입 단계
  let blockedBy: string | null = null;

  for (const nextStage of PROGRESSION_STAGES) {
    const nextLevel = STAGE_ORDER[nextStage];
    if (nextLevel > maxCalendarLevel) {
      // calendarStage 상한선 도달
      break;
    }

    const threshold = thresholdMap.get(nextStage);
    if (!threshold) {
      blockedBy = `missingThreshold:${nextStage}`;
      break;
    }

    if (input.metrics.conversationCount < threshold.minConversationCount) {
      blockedBy = "minConversationCount";
      break;
    }
    if (input.metrics.conversationDays < threshold.minConversationDays) {
      blockedBy = "minConversationDays";
      break;
    }
    if (input.metrics.usableMemoryCount < threshold.minUsableMemoryCount) {
      blockedBy = "minUsableMemoryCount";
      break;
    }
    if (input.metrics.sharedMemoryCount < threshold.minSharedMemoryCount) {
      blockedBy = "minSharedMemoryCount";
      break;
    }
    if (input.metrics.relationshipEventCount < threshold.minRelationshipEventCount) {
      blockedBy = "minRelationshipEventCount";
      break;
    }

    calculatedLevel = nextLevel;
  }

  // 자동 강등 방지 (currentEffectiveStage 고려)
  let finalLevel = calculatedLevel;
  if (input.currentEffectiveStage && STAGE_ORDER[input.currentEffectiveStage]) {
    const currentSavedLevel = STAGE_ORDER[input.currentEffectiveStage];
    if (currentSavedLevel > finalLevel) {
      finalLevel = currentSavedLevel;
    }
  }

  // effectiveStage <= calendarStage 상한 보장
  finalLevel = Math.min(finalLevel, maxCalendarLevel);

  return {
    effectiveStage: STAGE_FROM_ORDER[finalLevel] ?? null,
    ruleVersion: activeRuleSet.version,
    blockedBy,
  };
}
