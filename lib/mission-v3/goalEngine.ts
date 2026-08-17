import type { SupabaseClient } from "@supabase/supabase-js";

export const CONVERSATION_GOAL_COUNT = 10;
export const TARGET_COMPLETION_COUNT = 5;
export const MIN_GOAL_CONFIDENCE = 0.5;

export type GoalPriority = "P0" | "P1" | "P2" | "P3";
export type GoalStatus = "PENDING" | "SATISFIED" | "PARTIAL" | "DECLINED" | "SKIPPED";
export type GoalEvidenceSource = "child_utterance" | "parent_question" | "memory" | "system";

export interface ConversationGoal {
  goalId: string;
  missionSessionId: string;
  childId: string;
  goalOrder: number;
  semanticGroup: string;
  priority: GoalPriority;
  status: GoalStatus;
  evidenceSource: GoalEvidenceSource | null;
  sourceTurnId: string | null;
  confidence: number | null;
  satisfiedAt: string | null;
  parentQuestionId: string | null;
}

export interface GoalCandidate {
  semanticGroup: string;
  priority: Exclude<GoalPriority, "P0">;
  promptInstruction: string;
  questionId?: string;
}

export interface ParentQuestionCandidate {
  id: string;
  semanticGroup: string;
  promptInstruction: string;
}

export interface ConversationGoalDraft {
  missionSessionId: string;
  childId: string;
  goalOrder: number;
  semanticGroup: string;
  priority: GoalPriority;
  status: "PENDING";
  parentQuestionId: string | null;
  promptInstruction: string;
  questionId?: string | null;
}

export interface GoalAssessment {
  goalId: string;
  semanticGroup: string;
  status: "SATISFIED" | "PARTIAL" | "DECLINED" | "SKIPPED";
  confidence: number;
  evidenceSource: GoalEvidenceSource;
}

export interface GoalDecision {
  goalId: string;
  status: GoalAssessment["status"];
  evidenceSource: GoalEvidenceSource;
  sourceTurnId: string;
  confidence: number;
  satisfiedAt: string | null;
}

interface ConversationGoalRow {
  goal_id: string;
  mission_session_id: string;
  child_id: string;
  goal_order: number;
  semantic_group: string;
  priority: GoalPriority;
  status: GoalStatus;
  evidence_source: GoalEvidenceSource | null;
  source_turn_id: string | null;
  confidence: number | string | null;
  satisfied_at: string | null;
  parent_question_id: string | null;
}

interface ParentQuestionRow {
  id: string;
  question_text: string;
  confirmation_question_text: string | null;
  router_area: string | null;
  status: string;
}

const PRIORITY_ORDER: Record<GoalPriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

const READY_PARENT_QUESTION_STATUSES = [
  "reconfirm_pending",
  "ai_generated",
  "parent_edited",
] as const;

const GOAL_ASSESSMENT_STATUSES: readonly GoalAssessment["status"][] = [
  "SATISFIED",
  "PARTIAL",
  "DECLINED",
  "SKIPPED",
];

/**
 * Goal이 아직 열려 있는가(= 다시 물어볼 수 있고 SATISFIED로 승격될 수 있는가).
 *
 * 종료 상태는 SATISFIED/DECLINED 둘뿐이다. SKIPPED는 "직전 발화와 무관"이라는
 * 턴 단위 판정일 뿐 Goal 종료가 아니므로 열린 Goal에 포함한다.
 *
 * 이 판정이 호출부마다 복제돼 있어 2026-08-14 Production에서 두 번 어긋났다:
 * 질문 후보에서 SKIPPED를 빼 대화가 멈췄고, 판정 대상에서도 빼 게이지가 0으로
 * 고정됐다. 새 호출부는 반드시 이 함수를 쓴다.
 */
export const isOpenGoal = (goal: Pick<ConversationGoal, "status">): boolean =>
  goal.status === "PENDING" || goal.status === "PARTIAL" || goal.status === "SKIPPED";

const normalizeSemanticGroup = (value: string): string => value.trim().toUpperCase();

const toConversationGoal = (row: ConversationGoalRow): ConversationGoal => ({
  goalId: row.goal_id,
  missionSessionId: row.mission_session_id,
  childId: row.child_id,
  goalOrder: row.goal_order,
  semanticGroup: row.semantic_group,
  priority: row.priority,
  status: row.status,
  evidenceSource: row.evidence_source,
  sourceTurnId: row.source_turn_id,
  confidence: row.confidence === null ? null : Number(row.confidence),
  satisfiedAt: row.satisfied_at,
  parentQuestionId: row.parent_question_id,
});

const parentSemanticGroup = (row: ParentQuestionRow): string => {
  const routerArea = row.router_area?.trim();
  return routerArea
    ? `PARENT_${normalizeSemanticGroup(routerArea)}`
    : `PARENT_QUESTION_${row.id.toUpperCase()}`;
};

/**
 * Selects the four hidden goals for a daily_single mission. The parent question,
 * when present, always owns slot 1/P0. Remaining goals are stable-sorted by
 * priority and input order so Phase 2 can replace the candidate source with
 * question-bank metadata without changing this contract.
 */
export const selectConversationGoalDrafts = (input: {
  missionSessionId: string;
  childId: string;
  parentQuestion?: ParentQuestionCandidate | null;
  candidates: GoalCandidate[];
}): ConversationGoalDraft[] => {
  const selected: Array<Omit<ConversationGoalDraft, "goalOrder">> = [];
  const usedSemanticGroups = new Set<string>();

  if (input.parentQuestion) {
    const semanticGroup = normalizeSemanticGroup(input.parentQuestion.semanticGroup);
    if (!semanticGroup || !input.parentQuestion.promptInstruction.trim()) {
      throw new Error("부모 질문 Goal의 semantic group과 대화 지시는 비어 있을 수 없습니다.");
    }
    selected.push({
      missionSessionId: input.missionSessionId,
      childId: input.childId,
      semanticGroup,
      priority: "P0",
      status: "PENDING",
      parentQuestionId: input.parentQuestion.id,
      promptInstruction: input.parentQuestion.promptInstruction.trim(),
      questionId: input.parentQuestion.id,
    });
    usedSemanticGroups.add(semanticGroup);
  }

  const orderedCandidates = input.candidates
    .map((candidate, inputOrder) => ({ candidate, inputOrder }))
    .sort((left, right) => {
      const priorityDifference =
        PRIORITY_ORDER[left.candidate.priority] - PRIORITY_ORDER[right.candidate.priority];
      return priorityDifference || left.inputOrder - right.inputOrder;
    });

  for (const { candidate } of orderedCandidates) {
    if (selected.length === CONVERSATION_GOAL_COUNT) break;
    const semanticGroup = normalizeSemanticGroup(candidate.semanticGroup);
    if (!semanticGroup || !candidate.promptInstruction.trim() || usedSemanticGroups.has(semanticGroup)) {
      continue;
    }
    selected.push({
      missionSessionId: input.missionSessionId,
      childId: input.childId,
      semanticGroup,
      priority: candidate.priority,
      status: "PENDING",
      parentQuestionId: null,
      promptInstruction: candidate.promptInstruction.trim(),
      questionId: candidate.questionId ?? (candidate as { questionId?: string }).questionId ?? null,
    });
    usedSemanticGroups.add(semanticGroup);
  }

  if (selected.length === 0) {
    throw new Error("Conversation Goal 후보가 없습니다.");
  }

  return selected.map((goal, index) => ({ ...goal, goalOrder: index + 1 }));
};

export const loadHighestPriorityParentQuestion = async (
  db: SupabaseClient,
  childId: string,
): Promise<ParentQuestionCandidate | null> => {
  const reconfirmResult = await db
    .from("parent_questions")
    .select("id, question_text, confirmation_question_text, router_area, status")
    .eq("child_id", childId)
    .eq("status", READY_PARENT_QUESTION_STATUSES[0])
    .order("created_at", { ascending: true })
    .limit(1);

  if (reconfirmResult.error) {
    throw new Error(`부모 재확인 질문 조회 실패: ${reconfirmResult.error.message}`);
  }

  let rows = (reconfirmResult.data ?? []) as ParentQuestionRow[];
  if (rows.length === 0) {
    const readyResult = await db
      .from("parent_questions")
      .select("id, question_text, confirmation_question_text, router_area, status")
      .eq("child_id", childId)
      .in("status", READY_PARENT_QUESTION_STATUSES.slice(1))
      .order("created_at", { ascending: true })
      .limit(1);
    if (readyResult.error) {
      throw new Error(`부모 질문 조회 실패: ${readyResult.error.message}`);
    }
    rows = (readyResult.data ?? []) as ParentQuestionRow[];
  }

  const row = rows[0];
  if (!row) return null;

  const promptInstruction = row.confirmation_question_text || row.question_text;
  return {
    id: row.id,
    semanticGroup: parentSemanticGroup(row),
    promptInstruction,
  };
};

export const fetchSessionGoals = async (
  db: SupabaseClient,
  missionSessionId: string,
): Promise<ConversationGoal[]> => {
  const { data, error } = await db
    .from("conversation_goals")
    .select(
      "goal_id, mission_session_id, child_id, goal_order, semantic_group, priority, status, evidence_source, source_turn_id, confidence, satisfied_at, parent_question_id",
    )
    .eq("mission_session_id", missionSessionId)
    .order("goal_order", { ascending: true });
  if (error) throw new Error(`Conversation Goal 조회 실패: ${error.message}`);
  return ((data ?? []) as ConversationGoalRow[]).map(toConversationGoal);
};

/**
 * Idempotent Phase 1 initializer for a daily_single session. Route wiring and
 * the daily_single DB constraint arrive in later phases; callers must opt in
 * explicitly with sessionKind so legacy round sessions cannot use this path by accident.
 */
export const initializeConversationGoals = async (input: {
  db: SupabaseClient;
  missionSessionId: string;
  childId: string;
  sessionKind: "daily_single";
  candidates: GoalCandidate[];
}): Promise<ConversationGoal[]> => {
  if (input.sessionKind !== "daily_single") {
    throw new Error("Mission v3 Goal은 daily_single 세션에서만 초기화할 수 있습니다.");
  }
  const existing = await fetchSessionGoals(input.db, input.missionSessionId);
  if (existing.length === CONVERSATION_GOAL_COUNT) return existing;
  if (existing.length > CONVERSATION_GOAL_COUNT) {
    throw new Error(`세션에 Conversation Goal이 ${CONVERSATION_GOAL_COUNT}개보다 많이 존재합니다.`);
  }
  if (existing.some((goal) => goal.status !== "PENDING")) {
    return existing;
  }

  const parentQuestion = await loadHighestPriorityParentQuestion(input.db, input.childId);
  const drafts = selectConversationGoalDrafts({
    missionSessionId: input.missionSessionId,
    childId: input.childId,
    parentQuestion,
    candidates: input.candidates,
  });

  if (existing.length > 0) {
    // A previous interrupted initialization can leave rows whose order and
    // semantic_group collide with a newly composed draft through different
    // UNIQUE constraints. Pending-only rows are safe to replace as one set.
    const { error: resetError } = await input.db
      .from("conversation_goals")
      .delete()
      .eq("mission_session_id", input.missionSessionId)
      .eq("status", "PENDING");
    if (resetError) {
      throw new Error(`불완전 Conversation Goal 초기화 정리 실패: ${resetError.message}`);
    }
  }

  const { error } = await input.db.from("conversation_goals").insert(
    drafts.map((draft) => ({
      mission_session_id: draft.missionSessionId,
      child_id: draft.childId,
      goal_order: draft.goalOrder,
      semantic_group: draft.semanticGroup,
      priority: draft.priority,
      status: draft.status,
      parent_question_id: draft.parentQuestionId,
    })),
  );
  if (error && error.code !== "23505") {
    throw new Error(`Conversation Goal 생성 실패: ${error.message}`);
  }

  const initialized = await fetchSessionGoals(input.db, input.missionSessionId);
  if (initialized.length !== drafts.length) {
    throw new Error(`Conversation Goal 초기화가 불완전합니다. 생성 결과 ${initialized.length}개`);
  }
  return initialized;
};

/**
 * Converts one structured utterance assessment into zero or more goal updates.
 * Each assessment must carry evidence for the same source turn; therefore one
 * utterance can satisfy multiple distinct goals without repeated questioning.
 */
export const evaluateGoalSatisfaction = (input: {
  goals: ConversationGoal[];
  currentUtterance: string;
  sourceTurnId: string;
  assessedAt: string;
  assessments: GoalAssessment[];
}): GoalDecision[] => {
  if (!input.currentUtterance.trim() || !input.sourceTurnId.trim()) return [];

  const goalById = new Map(input.goals.map((goal) => [goal.goalId, goal]));
  const seenGoalIds = new Set<string>();

  return input.assessments.flatMap((assessment) => {
    if (seenGoalIds.has(assessment.goalId)) {
      throw new Error(`중복 Goal 판정입니다: ${assessment.goalId}`);
    }
    seenGoalIds.add(assessment.goalId);

    const goal = goalById.get(assessment.goalId);
    if (!goal) throw new Error(`세션에 없는 Goal 판정입니다: ${assessment.goalId}`);
    if (normalizeSemanticGroup(assessment.semanticGroup) !== normalizeSemanticGroup(goal.semanticGroup)) {
      throw new Error(`Goal semantic group 불일치: ${assessment.goalId}`);
    }
    // 상태값·confidence 범위 오류는 LLM 분류기의 품질 문제일 수 있어 판정 1건만
    // 무시하고 넘어간다 — throw하면 같은 턴의 다른 정상 판정까지 통째로 날아간다.
    if (!GOAL_ASSESSMENT_STATUSES.includes(assessment.status)) {
      console.error(`[mission-v3/goalEngine] Goal status 값 오류 — 이 판정만 무시: ${assessment.goalId} (${String(assessment.status)})`);
      return [];
    }
    if (!Number.isFinite(assessment.confidence) || assessment.confidence < 0 || assessment.confidence > 1) {
      console.error(`[mission-v3/goalEngine] Goal confidence 범위 오류 — 이 판정만 무시: ${assessment.goalId} (${assessment.confidence})`);
      return [];
    }
    if (assessment.confidence < MIN_GOAL_CONFIDENCE) return [];
    if (["SATISFIED", "DECLINED"].includes(goal.status)) return [];
    if (goal.status === "PARTIAL" && assessment.status === "PARTIAL") return [];
    if (goal.status === "SKIPPED" && assessment.status === "SKIPPED") return [];
    if (goal.status === "PARTIAL" && assessment.status === "SKIPPED") return [];

    return [{
      goalId: assessment.goalId,
      status: assessment.status,
      evidenceSource: assessment.evidenceSource,
      sourceTurnId: input.sourceTurnId,
      confidence: assessment.confidence,
      satisfiedAt: assessment.status === "SATISFIED" ? input.assessedAt : null,
    }];
  });
};

export interface PersistGoalDecisionsResult {
  succeeded: GoalDecision[];
  failures: string[];
}

/**
 * 일부 UPDATE만 실패해도 성공한 판정은 버리지 않는다 — 호출부(missionAdapter)가
 * 전체를 throw로 받으면 이미 저장된 판정까지 반환값에서 사라져 cooldown 기록·
 * promptGoal 선택이 실제 DB 상태와 어긋난다.
 */
export const persistGoalDecisions = async (
  db: SupabaseClient,
  decisions: GoalDecision[],
): Promise<PersistGoalDecisionsResult> => {
  const settled = await Promise.allSettled(
    decisions.map(async (decision) => {
      const { error } = await db
        .from("conversation_goals")
        .update({
          status: decision.status,
          evidence_source: decision.evidenceSource,
          source_turn_id: decision.sourceTurnId,
          confidence: decision.confidence,
          satisfied_at: decision.satisfiedAt,
          updated_at: new Date().toISOString(),
        })
        .eq("goal_id", decision.goalId)
        .in("status", ["PENDING", "PARTIAL", "SKIPPED"]);
      if (error) throw new Error(`${decision.goalId}: ${error.message}`);
      return decision;
    }),
  );

  const succeeded: GoalDecision[] = [];
  const failures: string[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") succeeded.push(result.value);
    else failures.push(String(result.reason));
  }
  return { succeeded, failures };
};

export const countSatisfiedGoals = (goals: ConversationGoal[]): number =>
  goals.filter((goal) => goal.status === "SATISFIED").length;

export const getCompletionThreshold = (goals: ConversationGoal[]): number =>
  goals.length === 0 ? TARGET_COMPLETION_COUNT : Math.min(TARGET_COMPLETION_COUNT, goals.length);

export const hasMissionGoalThreshold = (goals: ConversationGoal[]): boolean =>
  goals.length > 0 && countSatisfiedGoals(goals) >= getCompletionThreshold(goals);
