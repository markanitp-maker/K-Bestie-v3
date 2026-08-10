import type { SupabaseClient } from "@supabase/supabase-js";

import {
  checkSafetyPreflight,
  respond,
  type ConversationAction,
  type EngineOutput,
  type GenerateArgs,
} from "@/lib/k-conversation";
import {
  isTopicOnCooldownForK,
  recordTopicUsage,
} from "@/lib/k-conversation/semanticTopicHistory";
import {
  evaluateGoalSatisfaction,
  persistGoalDecisions,
  type ConversationGoal,
  type GoalAssessment,
  type GoalDecision,
} from "@/lib/mission-v3/goalEngine";

export interface MissionPromptGoal extends ConversationGoal {
  promptInstruction: string;
}

export interface MissionAdapterResult {
  engineOutput: EngineOutput;
  goalDecisions: GoalDecision[];
  promptedGoalId: string | null;
}

export interface MissionAdapterEngine {
  checkSafetyPreflight: typeof checkSafetyPreflight;
  respond: typeof respond;
  isTopicOnCooldownForK: typeof isTopicOnCooldownForK;
  recordTopicUsage: typeof recordTopicUsage;
}

const DEFAULT_ENGINE: MissionAdapterEngine = {
  checkSafetyPreflight,
  respond,
  isTopicOnCooldownForK,
  recordTopicUsage,
};

const GOAL_PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;

const applyDecisions = (
  goals: MissionPromptGoal[],
  decisions: GoalDecision[],
): MissionPromptGoal[] => {
  const decisionByGoalId = new Map(decisions.map((decision) => [decision.goalId, decision]));
  return goals.map((goal) => {
    const decision = decisionByGoalId.get(goal.goalId);
    if (!decision) return goal;
    return {
      ...goal,
      status: decision.status,
      evidenceSource: decision.evidenceSource,
      sourceTurnId: decision.sourceTurnId,
      confidence: decision.confidence,
      satisfiedAt: decision.satisfiedAt,
    };
  });
};

export const selectNextPromptGoal = async (
  db: SupabaseClient,
  childId: string,
  goals: MissionPromptGoal[],
  engine: Pick<MissionAdapterEngine, "isTopicOnCooldownForK"> = DEFAULT_ENGINE,
): Promise<MissionPromptGoal | null> => {
  const candidates = goals
    .filter((goal) => goal.status === "PENDING" || goal.status === "PARTIAL")
    .sort((left, right) => {
      const priorityDifference = GOAL_PRIORITY_ORDER[left.priority] - GOAL_PRIORITY_ORDER[right.priority];
      return priorityDifference || left.goalOrder - right.goalOrder;
    });

  for (const goal of candidates) {
    // Parent Question P0 may override general cooldown, but a DECLINED/SKIPPED P0
    // never reaches this list and therefore cannot be asked again in the session.
    if (goal.priority === "P0" && goal.parentQuestionId) return goal;
    const settled = await Promise.allSettled([
      engine.isTopicOnCooldownForK(db, childId, goal.semanticGroup),
    ]);
    const cooldownResult = settled[0];
    if (cooldownResult.status === "rejected") {
      console.error("[mission-v3/adapter] cooldown lookup rejected", cooldownResult.reason);
      return goal;
    }
    if (!cooldownResult.value) return goal;
  }
  return null;
};

const buildAdapterInstruction = (goal: MissionPromptGoal | null): string | undefined => {
  if (!goal) return undefined;
  return [
    "아이의 방금 말에 먼저 자연스럽게 반응해.",
    `어색하지 않을 때만 다음 대화 방향을 한 번 이어가: ${goal.promptInstruction.trim()}`,
    "목표, 우선순위, 체크리스트, 질문 출처는 말하지 마.",
    "아이가 거절하거나 화제를 바꾸면 반복해서 추궁하지 마.",
  ].join(" ");
};

/**
 * Thin 073 adapter: Safety preflight and response generation remain owned by
 * the 071 engine. Goal state and parent-question provenance remain outside it;
 * only an opaque natural-language adapterInstruction crosses the boundary.
 */
export const respondToMissionTurn = async (input: {
  db: SupabaseClient;
  ai: GenerateArgs["ai"];
  modelId: string;
  childId: string;
  sessionId: string;
  currentUtterance: string;
  sourceTurnId: string;
  assessedAt?: string;
  asrConfidence?: number;
  appMode?: "auto" | "manual";
  goals: MissionPromptGoal[];
  assessments: GoalAssessment[];
  recentActions?: ConversationAction[];
  engine?: MissionAdapterEngine;
}): Promise<MissionAdapterResult> => {
  const engine = input.engine ?? DEFAULT_ENGINE;
  const safetyOutput = await engine.checkSafetyPreflight(
    input.db,
    input.sessionId,
    input.currentUtterance,
  );
  if (safetyOutput) {
    return { engineOutput: safetyOutput, goalDecisions: [], promptedGoalId: null };
  }

  const goalDecisions = evaluateGoalSatisfaction({
    goals: input.goals,
    currentUtterance: input.currentUtterance,
    sourceTurnId: input.sourceTurnId,
    assessedAt: input.assessedAt ?? new Date().toISOString(),
    assessments: input.assessments,
  });
  await persistGoalDecisions(input.db, goalDecisions);

  const currentGoals = applyDecisions(input.goals, goalDecisions);
  const promptGoal = await selectNextPromptGoal(input.db, input.childId, currentGoals, engine);
  const engineOutput = await engine.respond(
    {
      childId: input.childId,
      sessionId: input.sessionId,
      mode: "MISSION",
      currentUtterance: input.currentUtterance,
      asrConfidence: input.asrConfidence,
      appMode: input.appMode,
    },
    {
      db: input.db,
      ai: input.ai,
      modelId: input.modelId,
      adapterInstruction: buildAdapterInstruction(promptGoal),
      recentActions: input.recentActions,
    },
  );

  if (promptGoal && engineOutput.category === "generated") {
    await engine.recordTopicUsage(
      input.db,
      input.childId,
      promptGoal.semanticGroup,
      "mission",
      promptGoal.parentQuestionId ? "parent_question" : "k",
    );
  }

  return {
    engineOutput,
    goalDecisions,
    promptedGoalId: promptGoal?.goalId ?? null,
  };
};
