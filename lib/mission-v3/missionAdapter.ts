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
  isOpenGoal,
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
    .filter(isOpenGoal)
    .sort((left, right) => {
      const priorityDifference = GOAL_PRIORITY_ORDER[left.priority] - GOAL_PRIORITY_ORDER[right.priority];
      return priorityDifference || left.goalOrder - right.goalOrder;
    });

  for (const goal of candidates) {
    // Parent Question P0 may override general cooldown, but a DECLINED P0 never
    // reaches this list and therefore cannot be asked again in the session.
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
    // "어색하지 않을 때만"은 너무 약한 권유라 모델이 대부분 무시하고 지금 화제에서
    // 되묻기만 했다. 그러면 질문은 나오는데 새 Goal 주제로 넘어가지 않아 게이지가
    // 중간에 멈춘다(2026-08-14 Production 실측: 4개 달성 후 정체).
    // 반응은 짧게, 마지막은 아래 방향의 질문 하나로 끝내게 한다.
    "아이의 방금 말에 한 문장으로 짧게 반응해.",
    `그다음 반드시 이 방향으로 질문 하나를 던져 마무리해: ${goal.promptInstruction.trim()}`,
    "질문은 하나만, 아이가 바로 답할 수 있게 짧고 쉽게.",
    "목표, 우선순위, 체크리스트, 질문 출처는 말하지 마.",
    "다만 아이가 방금 그 주제를 거절했거나 힘들어하면 이번에는 묻지 말고 반응만 해.",
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
  /** clientTurnId — start_mission_turn_v3가 chat_messages.turn_id로 저장하는 canonical ID.
   * child_message_id(sourceTurnId)와는 다른 값이므로 혼용하지 않는다(005 §3-3). */
  currentTurnId?: string;
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
    {
      childId: input.childId,
      mode: "MISSION",
    },
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
      currentUtteranceAlreadyInSession: true,
      currentTurnId: input.currentTurnId,
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
