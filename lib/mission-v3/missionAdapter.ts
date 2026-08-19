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
  /**
   * 이 Goal 을 그대로 물어볼 수 있는 완성된 질문 문장(019 §3-2, §6-1).
   * 질문은행 원문 또는 부모 질문 문장이다. LLM 자연어 생성이 전부 실패했을 때
   * 추가 호출 없이 다음 질문으로 진행하기 위해 쓴다.
   */
  fallbackQuestionText?: string | null;
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

  if (candidates.length === 0) return null;

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

  // 열린 Goal이 전부 cooldown이어도 null을 돌려주면 안 된다. 그러면 K가 이번 턴에
  // 던질 목표가 없어 잡담만 하고, 아이가 아무리 대화해도 게이지가 오르지 않아
  // 미션이 끝나지 않는다(2026-08-16 안서현 Production: prompted_goal_id가 세션 내내
  // 전부 null, 남은 Goal 3개가 모두 cooldown이었다).
  //
  // cooldown은 "세션 시작 시 어떤 주제를 새로 고를지"를 위한 장치다. 이미 이번
  // 세션 Goal로 확정된 주제는 물어봐야 미션이 진행된다 — 여기서는 순서를 미루는
  // 용도로만 쓰고, 마지막에는 우선순위가 가장 높은 Goal을 그대로 고른다.
  console.warn("[mission-v3/adapter] 열린 Goal이 모두 cooldown — 우선순위 상위 Goal로 진행", {
    childId,
    openGoalCount: candidates.length,
  });
  return candidates[0];
};

const buildAdapterInstruction = (goal: MissionPromptGoal | null): string | undefined => {
  if (!goal) return undefined;
  return [
    // 2026-08-14/17 실측 이력: "어색하지 않을 때만" 같은 약한 권유는 무시됐고,
    // 반대로 "반드시 이 질문" 은 아이 말을 튕겨내는 인터뷰가 됐다. 그래서 지금은
    // "먼저 받고, 그 이야기에서 파생된 질문으로 방향을 잡는다" 로 통합한다(013 §3-2, §3-3).
    //
    // 013 핵심 변경: 아래 방향(promptInstruction)은 도달해야 할 주제이지 읽어야 할
    // 문장이 아니다. 아이가 방금 한 이야기에서 자연스럽게 파생된 질문이 그 방향을
    // 향할 수 있으면 그 질문을 우선한다. 질문지 문장을 그대로 옮기는 것보다,
    // 아이 이야기에 이어지는 질문이 항상 낫다.
    "먼저 아이의 방금 말에 한 문장으로 짧게 반응해.",
    "그다음 질문 하나로 마무리해. 질문은 아이가 방금 한 이야기에서 자연스럽게 이어지는 것을 우선하고,",
    "그 이야기와 아래 방향이 이어질 수 있으면 이어진 형태로 물어봐:",
    `${goal.promptInstruction.trim()}`,
    "아이 이야기와 이 방향이 도저히 안 이어질 때만 짧고 자연스럽게 화제를 옮겨.",
    // 013 §3-3 — 기계적 전환 문구 금지.
    "\"이제 다음 질문할게\", \"그럼 다른 질문 해볼게\", \"네 얘기 잘 들었어. 그런데\" 같은 전환 멘트는 쓰지 마.",
    // 013 §3-6 — 이미 확보한 정보 재질문 금지(변화·후속은 허용).
    "아이가 이미 말한 내용을 표현만 바꿔 다시 묻지 마. 대신 그 뒤 이야기나 달라진 점을 물어봐.",
    "질문은 하나만, 아이가 바로 답할 수 있게 짧고 쉽게. 목표, 우선순위, 체크리스트, 질문 출처는 말하지 마.",
    "예외: 아이가 너에게 질문했거나 뭔가를 지적했으면 그 답을 먼저 하고, 그 턴에는 미션 질문을 하지 마. 아이가 방금 그 주제를 거절했거나 힘들어할 때도 묻지 말고 반응만 해. 아이가 지금 하는 이야기가 이어지는 중이면 그 이야기를 먼저 따라가.",
    "복귀: 예외로 넘긴 다음 턴에는 다시 질문으로 대화를 이어가.",
  ].join(" ");
};

/**
 * 019 §3-1, §3-9 — 미션에서 나오면 안 되는 폴백 계열 문구.
 * 아이 답변이 이미 완료된 턴에서 같은 답을 다시 요구하는 말이다.
 * 정확 일치뿐 아니라 같은 의미의 변형도 잡는다.
 */
export const MISSION_FORBIDDEN_FALLBACK_PATTERNS: readonly RegExp[] = [
  /더\s*얘기해\s*줄래/,
  /더\s*이야기해\s*줄래/,
  /더\s*말해\s*줄래/,
  /계속\s*말해\s*줘/,
  /계속\s*얘기해\s*줘/,
  /계속\s*이야기해\s*줘/,
  /더\s*말해\s*줘/,
  /더\s*얘기해\s*줘/,
];

export const containsMissionForbiddenFallback = (text: string): boolean =>
  MISSION_FORBIDDEN_FALLBACK_PATTERNS.some((pattern) => pattern.test(text));

/**
 * 던질 다음 질문이 없을 때의 최후 문장. 아이 답변을 받아들이기만 하고 다시 요구하지 않는다.
 * 자유대화 폴백("더 얘기해줄래?")이 미션으로 새어 나가는 것을 막는 마지막 장치다(019 §3-1).
 */
export const MISSION_FALLBACK_ACKNOWLEDGEMENT_ONLY = "그렇구나, 얘기해줘서 고마워.";

/** 결정론 폴백에 쓰는 짧은 인정 문구. LLM 을 다시 부르지 않는다(019 §3-2). */
const FALLBACK_ACKNOWLEDGEMENTS = [
  "그렇구나, 얘기해줘서 고마워.",
  "오, 그랬구나.",
  "응, 잘 들었어.",
] as const;

/**
 * 아이 답변이 이미 처리된 미션 턴에서 자연어 생성이 실패했을 때 쓸 문장을 만든다.
 *
 * 우선순위(019 §3-2, §6-1, §6-2):
 *   1. 이번 턴에 고른 promptGoal 의 완성 질문 문장
 *   2. 열린 Goal 중 아무거나의 완성 질문 문장
 *   3. 둘 다 없으면 null — 호출부가 기존 폴백을 그대로 둔다(미션이 사실상 끝난 상태)
 *
 * ack 문구는 턴마다 같은 말이 반복되지 않도록 sourceTurnId 로 고른다. 난수를 쓰지 않아
 * 같은 턴을 재시도해도 같은 문장이 나온다(중복 저장 시 화면이 흔들리지 않는다).
 */
export const buildMissionDeterministicFallback = (input: {
  promptGoal: MissionPromptGoal | null;
  goals: MissionPromptGoal[];
  seed?: string;
}): string | null => {
  const question = input.promptGoal?.fallbackQuestionText?.trim()
    || input.goals.filter(isOpenGoal).map((goal) => goal.fallbackQuestionText?.trim()).find(Boolean)
    || null;
  if (!question) return null;

  const seed = input.seed ?? "";
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const ack = FALLBACK_ACKNOWLEDGEMENTS[hash % FALLBACK_ACKNOWLEDGEMENTS.length];
  return `${ack} ${question}`;
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
  let engineOutput = await engine.respond(
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

  // 019 §3-1~§3-3 — 자연어 생성이 전부 실패했을 때.
  //
  // Goal 판정과 별 게이지는 이 위에서 이미 확정됐다(evaluateGoalSatisfaction →
  // persistGoalDecisions). 생성 실패는 아이 답변을 무효로 만들지 않는다. 자유대화용
  // 폴백("응, 듣고 있어. 더 얘기해줄래?")은 아이가 방금 다 대답한 미션 턴에서
  // 같은 답을 다시 요구하는 말이 되므로, 이미 정해진 다음 질문으로 대체한다.
  // Safety 응답(category === "safety")은 절대 건드리지 않는다(019 §3-11).
  if (engineOutput.generationFallback && engineOutput.category !== "safety") {
    const deterministic = buildMissionDeterministicFallback({
      promptGoal,
      goals: currentGoals,
      seed: input.currentTurnId ?? input.sourceTurnId,
    });
    // 던질 질문이 하나도 없으면(열린 Goal 소진 등) 인정 문구만 남긴다. 어떤 경우에도
    // 자유대화 폴백이 미션 밖으로 나가서는 안 된다 — 아이가 방금 다 대답한 턴이다.
    const replacement = deterministic ?? MISSION_FALLBACK_ACKNOWLEDGEMENT_ONLY;
    console.error(
      "[mission-v3/adapter] 자연어 생성 실패 — 결정론 미션 폴백으로 진행",
      JSON.stringify({
        failureType: engineOutput.generationFailureType ?? null,
        sessionId: input.sessionId,
        turnId: input.currentTurnId ?? null,
        promptGoalId: promptGoal?.goalId ?? null,
        hasNextQuestion: deterministic !== null,
      }),
    );
    engineOutput = { ...engineOutput, text: replacement };
  }

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
