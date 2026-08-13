import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchSessionGoals,
  getCompletionThreshold,
  type ConversationGoal,
  type GoalAssessment,
} from "@/lib/mission-v3/goalEngine";
import type { MissionPromptGoal } from "@/lib/mission-v3/missionAdapter";
import {
  loadMissionQuestionGoalCandidates,
  type MissionWeekday,
} from "@/lib/mission-v3/questionBank";

interface ParentQuestionPromptRow {
  id: string;
  question_text: string;
  confirmation_question_text: string | null;
}

interface HistoryRow {
  role: string;
  content: string;
  turn_id: string | null;
  created_at?: string;
  display_sequence?: number | null;
}

const GOAL_ASSESSMENT_STATUSES: ReadonlySet<GoalAssessment["status"]> = new Set([
  "SATISFIED",
  "PARTIAL",
  "DECLINED",
  "SKIPPED",
]);

const MISSION_WEEKDAYS: ReadonlySet<MissionWeekday> = new Set([
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
]);

const normalizeSemanticGroup = (value: string): string => value.trim().toUpperCase();

export const DEFAULT_MISSION_COMPLETION_MESSAGE = "오늘 미션을 모두 완료했어. 소중한 이야기 들려줘서 고마워!";

export const buildCompletionKMessage = (rawKResponse: string): string => {
  const trimmed = rawKResponse.trim();
  if (!trimmed) return DEFAULT_MISSION_COMPLETION_MESSAGE;

  const qIndex = trimmed.indexOf("?");
  let reactionPart = "";
  if (qIndex !== -1) {
    const beforeQ = trimmed.slice(0, qIndex);
    const lastSentenceEnd = Math.max(beforeQ.lastIndexOf("!"), beforeQ.lastIndexOf("."));
    if (lastSentenceEnd !== -1) {
      reactionPart = beforeQ.slice(0, lastSentenceEnd + 1).trim();
    } else {
      reactionPart = "";
    }
  } else {
    reactionPart = trimmed;
  }

  if (reactionPart && reactionPart.length >= 3) {
    const combined = `${reactionPart} ${DEFAULT_MISSION_COMPLETION_MESSAGE}`;
    if (combined.length <= 80) {
      return combined;
    }
  }

  return DEFAULT_MISSION_COMPLETION_MESSAGE;
};

export const getMissionWeekday = (now: Date = new Date()): MissionWeekday => {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
  }).format(now).toLowerCase() as MissionWeekday;

  if (!MISSION_WEEKDAYS.has(weekday)) {
    throw new Error("KST 미션 요일을 계산할 수 없습니다.");
  }
  return weekday;
};
export const fetchMissionGoals = fetchSessionGoals;

export const buildGoalProgress = (goals: ConversationGoal[]) => ({
  total: goals.length,
  satisfied: goals.filter((goal) => goal.status === "SATISFIED").length,
  partial: goals.filter((goal) => goal.status === "PARTIAL").length,
  pending: goals.filter((goal) => goal.status === "PENDING").length,
  declined: goals.filter((goal) => goal.status === "DECLINED").length,
  skipped: goals.filter((goal) => goal.status === "SKIPPED").length,
  completionThreshold: getCompletionThreshold(goals),
});

export const loadMissionPromptGoals = async (input: {
  db: SupabaseClient;
  childId: string;
  grade: number;
  goals: ConversationGoal[];
  now?: Date;
}): Promise<MissionPromptGoal[]> => {
  if (input.goals.length === 0) return [];

  const bankCandidates = await loadMissionQuestionGoalCandidates({
    db: input.db,
    childId: input.childId,
    grade: input.grade,
    weekday: getMissionWeekday(input.now),
  });
  const instructionBySemanticGroup = new Map<string, string>();
  for (const candidate of bankCandidates) {
    const semanticGroup = normalizeSemanticGroup(candidate.semanticGroup);
    if (!instructionBySemanticGroup.has(semanticGroup)) {
      instructionBySemanticGroup.set(semanticGroup, candidate.promptInstruction);
    }
  }

  const parentQuestionIds = [...new Set(
    input.goals
      .map((goal) => goal.parentQuestionId)
      .filter((id): id is string => Boolean(id)),
  )];
  const parentInstructionById = new Map<string, string>();
  if (parentQuestionIds.length > 0) {
    const { data, error } = await input.db
      .from("parent_questions")
      .select("id, question_text, confirmation_question_text")
      .in("id", parentQuestionIds);
    if (error) throw new Error(`부모 질문 Goal 복원 실패: ${error.message}`);
    for (const row of (data ?? []) as ParentQuestionPromptRow[]) {
      const instruction = (row.confirmation_question_text || row.question_text).trim();
      if (instruction) parentInstructionById.set(row.id, instruction);
    }
  }

  return input.goals.map((goal) => {
    const promptInstruction = goal.parentQuestionId
      ? parentInstructionById.get(goal.parentQuestionId)
      : instructionBySemanticGroup.get(normalizeSemanticGroup(goal.semanticGroup));
    if (!promptInstruction) {
      throw new Error(`Conversation Goal 대화 지시를 복원할 수 없습니다: ${goal.goalId}`);
    }
    return { ...goal, promptInstruction };
  });
};

export const parseStoredGoalAssessments = (
  value: unknown,
  goals: MissionPromptGoal[],
): GoalAssessment[] => {
  if (!Array.isArray(value)) {
    throw new Error("저장된 Goal 판정 결과가 배열이 아닙니다.");
  }

  const goalById = new Map(goals.map((goal) => [goal.goalId, goal]));
  const seenGoalIds = new Set<string>();
  return value.flatMap((candidate): GoalAssessment[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as Record<string, unknown>;
    const goalId = typeof row.goalId === "string" ? row.goalId : "";
    const goal = goalById.get(goalId);
    if (!goal || seenGoalIds.has(goalId)) return [];
    if (typeof row.semanticGroup !== "string"
      || normalizeSemanticGroup(row.semanticGroup) !== normalizeSemanticGroup(goal.semanticGroup)) {
      return [];
    }
    if (typeof row.status !== "string"
      || !GOAL_ASSESSMENT_STATUSES.has(row.status as GoalAssessment["status"])) {
      return [];
    }
    if (typeof row.confidence !== "number"
      || !Number.isFinite(row.confidence)
      || row.confidence < 0
      || row.confidence > 1
      || row.evidenceSource !== "child_utterance") {
      return [];
    }

    seenGoalIds.add(goalId);
    return [{
      goalId,
      semanticGroup: goal.semanticGroup,
      status: row.status as GoalAssessment["status"],
      confidence: row.confidence,
      evidenceSource: "child_utterance",
    }];
  });
};

export const fetchRecentMissionHistory = async (input: {
  db: SupabaseClient;
  sessionId: string;
  currentTurnId: string;
}): Promise<Array<{ role: "child" | "k"; text: string }>> => {
  const { data, error } = await input.db
    .from("chat_messages")
    .select("role, content, turn_id, created_at, display_sequence")
    .eq("session_id", input.sessionId)
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("display_sequence", { ascending: false, nullsFirst: false })
    .limit(20);
  if (error) {
    console.error("[mission/v3] 최근 대화 조회 실패", error.message);
    return [];
  }

  const rows = (data ?? []) as HistoryRow[];
  const seenTurnIds = new Set<string>();
  const dedupedRows: HistoryRow[] = [];

  for (const row of rows) {
    if (row.turn_id === input.currentTurnId) {
      continue;
    }
    if (row.turn_id !== null && row.turn_id !== undefined) {
      if (seenTurnIds.has(row.turn_id)) {
        continue;
      }
      seenTurnIds.add(row.turn_id);
    }
    dedupedRows.push(row);
  }

  return dedupedRows
    .filter((row): row is HistoryRow & { role: "child" | "k" } => (
      (row.role === "child" || row.role === "k") && Boolean(row.content.trim())
    ))
    .slice(0, 8)
    .reverse()
    .map((row) => ({ role: row.role, text: row.content.trim() }));
};
