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
  /**
   * goalId K actively prompted toward on the PREVIOUS turn (the caller persists
   * the prior call's `promptedGoalId` and passes it back in). Required to tell
   * "child answered what K just asked" apart from "child brought this up on
   * their own" — the Goal that gets SATISFIED this call is always excluded
   * from this call's own promptGoal selection, so comparing against the
   * freshly-selected promptGoal can never match.
   */
  previousPromptedGoalId?: string | null;
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

  let goalDecisions: GoalDecision[] = [];
  try {
    const evaluatedDecisions = evaluateGoalSatisfaction({
      goals: input.goals,
      currentUtterance: input.currentUtterance,
      sourceTurnId: input.sourceTurnId,
      assessedAt: input.assessedAt ?? new Date().toISOString(),
      assessments: input.assessments,
    });
    const { succeeded, failures } = await persistGoalDecisions(input.db, evaluatedDecisions);
    goalDecisions = succeeded;
    if (failures.length > 0) {
      console.error("[mission-v3/adapter] Goal decision persistence partially failed", failures);
    }
  } catch (error) {
    console.error("[mission-v3/adapter] Goal evaluation failed", error);
  }

  const currentGoals = applyDecisions(input.goals, goalDecisions);
  let promptGoal: MissionPromptGoal | null = null;
  try {
    promptGoal = await selectNextPromptGoal(input.db, input.childId, currentGoals, engine);
  } catch (error) {
    console.error("[mission-v3/adapter] Goal prompt selection failed", error);
  }
  const engineOutput = await engine.respond(
    {
      childId: input.childId,
      sessionId: input.sessionId,
      mode: "MISSION",
      currentUtterance: input.currentUtterance,
      asrConfidence: input.asrConfidence,
      appMode: input.appMode,
      // v3 턴 RPC가 respond() 호출 전에 아이 발화를 이미 finalized로 저장한다 —
      // Engine이 same-session 조회 결과에 currentUtterance를 중복 append하지
      // 않도록 명시한다(게이트① 2라운드 [복잡] 지적 대응).
      currentUtteranceAlreadyInSession: true,
    },
    {
      db: input.db,
      ai: input.ai,
      modelId: input.modelId,
      adapterInstruction: buildAdapterInstruction(promptGoal),
      recentActions: input.recentActions,
    },
  );

  // EngineOutput only reports the response category/action; it cannot prove
  // that the model actually followed adapterInstruction. Record a cooldown
  // only once a Goal reaches SATISFIED — PARTIAL is still an open goal and
  // would otherwise lock itself out of re-asking for cooldownDays.
  //
  // KNOWN LIMITATION (codex-rv-073-phase1-r3, tracked for Phase 2): a Goal
  // can be selected as promptGoal and returned as promptedGoalId even when
  // the "only if natural" adapterInstruction caused K to not actually ask
  // about it — 071's respond() has no contract to report whether a specific
  // instruction was honored. If the child then spontaneously satisfies that
  // same Goal next turn, wasPrompted below will incorrectly credit "k".
  // Fixing this precisely requires either an additive 071 EngineOutput signal
  // (out of Phase 1's "don't touch 071" boundary) or route-layer disambiguation
  // in Phase 2. Zero live impact today — no route wires this adapter yet.
  const satisfiedGoalIds = new Set(
    goalDecisions
      .filter((decision) => decision.status === "SATISFIED")
      .map((decision) => decision.goalId),
  );
  const cooldownResults = await Promise.allSettled(
    input.goals
      .filter((goal) => satisfiedGoalIds.has(goal.goalId))
      .map((goal) => {
        // Only credit "k" (or its parent-question provenance) when K was the
        // one prompting toward this Goal on the turn whose evidence just
        // satisfied it. A Goal the child satisfied unprompted must be recorded
        // as child-initiated per 071 §9 (never cooldown the child's own topics).
        const wasPrompted = goal.goalId === input.previousPromptedGoalId;
        const initiatedBy = wasPrompted
          ? (goal.parentQuestionId ? "parent_question" : "k")
          : "child";
        return engine.recordTopicUsage(
          input.db,
          input.childId,
          goal.semanticGroup,
          "mission",
          initiatedBy,
        );
      }),
  );
  for (const result of cooldownResults) {
    if (result.status === "rejected") {
      console.error("[mission-v3/adapter] Goal cooldown recording failed", result.reason);
    }
  }

  return {
    engineOutput,
    goalDecisions,
    promptedGoalId: promptGoal?.goalId ?? null,
  };
};
