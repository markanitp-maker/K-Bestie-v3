import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchRecentTopics,
  isTopicOnCooldownForK,
  recordTopicUsage,
  type TopicInitiator,
} from "@/lib/k-conversation/semanticTopicHistory";
import type { GoalCandidate } from "@/lib/mission-v3/goalEngine";

export type MissionWeekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type QuestionPeriodicity = "onboarding_once" | "flexible" | "weekly" | "monthly" | "quarterly";
export type QuestionSensitivity = "low" | "medium" | "high";

export interface MissionQuestionMetadataRow {
  id: string;
  questionText: string;
  applicableGrades: number[];
  semanticGroup: string;
  cooldownDays: number;
  weekdayAffinity: MissionWeekday[];
  topic: string;
  conversationStyle: string;
  funType: string;
  memoryUsable: boolean;
  sensitivity: QuestionSensitivity;
  answerMode: string;
  periodicity: QuestionPeriodicity;
}

export interface MissionQuestionGoalCandidate extends GoalCandidate {
  questionId: string;
  questionText: string;
  cooldownDays: number;
  topic: string;
  memoryUsable: boolean;
  sensitivity: QuestionSensitivity;
}

interface MissionQuestionDbRow {
  id: string;
  question_text: string;
  applicable_grades: number[];
  semantic_group: string;
  cooldown_days: number;
  weekday_affinity: string[];
  topic: string;
  conversation_style: string;
  fun_type: string;
  memory_usable: boolean;
  sensitivity: QuestionSensitivity;
  answer_mode: string;
  periodicity: QuestionPeriodicity;
}

const PRIORITY_ORDER: Record<GoalCandidate["priority"], number> = {
  P1: 1,
  P2: 2,
  P3: 3,
};

const WEEKDAYS = new Set<MissionWeekday>([
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
]);

const normalizeSemanticGroup = (value: string): string => value.trim().toUpperCase();

const toWeekdays = (values: string[]): MissionWeekday[] => values.filter(
  (value): value is MissionWeekday => WEEKDAYS.has(value as MissionWeekday),
);

const toMetadataRow = (row: MissionQuestionDbRow): MissionQuestionMetadataRow => ({
  id: row.id,
  questionText: row.question_text,
  applicableGrades: row.applicable_grades,
  semanticGroup: normalizeSemanticGroup(row.semantic_group),
  cooldownDays: row.cooldown_days,
  weekdayAffinity: toWeekdays(row.weekday_affinity),
  topic: row.topic,
  conversationStyle: row.conversation_style,
  funType: row.fun_type,
  memoryUsable: row.memory_usable,
  sensitivity: row.sensitivity,
  answerMode: row.answer_mode,
  periodicity: row.periodicity,
});

const styleInstruction = (style: string): string => {
  switch (style) {
    case "permission_first":
      return "답하지 않아도 괜찮다는 선택권을 먼저 보장하고";
    case "child_as_expert":
      return "아이가 케이에게 알려주는 역할이 되도록 호기심을 보이며";
    case "reflective":
      return "평가하지 말고 아이가 기억을 천천히 떠올리도록 기다리며";
    case "imaginative":
      return "정답을 정하지 말고 상상을 함께 즐기며";
    case "choice_based":
      return "선택지를 강요하지 않고 아이가 다른 답도 할 수 있게 열어두며";
    default:
      return "아이의 직전 발화와 자연스럽게 연결해";
  }
};

const answerInstruction = (answerMode: string): string => {
  switch (answerMode) {
    case "optional_open":
      return "거절하거나 넘어가면 재질문하지 마.";
    case "choice":
      return "제시된 선택지 밖의 답도 존중해.";
    case "metaphor":
      return "비유를 어려워하면 평범한 말로 답해도 된다고 알려줘.";
    case "short_open":
      return "짧은 답도 충분히 받아들여.";
    default:
      return "한 번에 질문은 하나만 하고 답을 평가하지 마.";
  }
};

/**
 * Phase 1 GoalCandidate 계약을 그대로 만족시키는 질문은행 adapter다.
 * 주기 질문은 P1, 오늘 요일과 affinity가 맞는 질문은 P2, 나머지는 P3다.
 */
export const toGoalCandidate = (
  question: MissionQuestionMetadataRow,
  weekday: MissionWeekday,
): MissionQuestionGoalCandidate => {
  const priority: GoalCandidate["priority"] = question.periodicity !== "flexible"
    ? "P1"
    : question.weekdayAffinity.includes(weekday)
      ? "P2"
      : "P3";

  return {
    questionId: question.id,
    questionText: question.questionText,
    semanticGroup: normalizeSemanticGroup(question.semanticGroup),
    priority,
    promptInstruction: [
      `${styleInstruction(question.conversationStyle)} '${question.topic}' 주제를 탐색해.`,
      `질문은행 문장 '${question.questionText.trim()}'의 의미를 유지하되 대화 흐름에 맞게 자연스럽게 표현해.`,
      answerInstruction(question.answerMode),
    ].join(" "),
    cooldownDays: question.cooldownDays,
    topic: question.topic,
    memoryUsable: question.memoryUsable,
    sensitivity: question.sensitivity,
  };
};

/**
 * K가 먼저 질문은행 주제를 제안할 때만 cooldown을 적용한다. child와
 * parent_question이 먼저 꺼낸 주제는 이 필터에서 절대 제외하지 않는다.
 */
export const filterQuestionCandidatesByCooldown = async (input: {
  db: SupabaseClient;
  childId: string;
  candidates: MissionQuestionGoalCandidate[];
  initiatedBy: TopicInitiator;
}): Promise<MissionQuestionGoalCandidate[]> => {
  if (input.initiatedBy !== "k") return input.candidates;

  const semanticGroups = [...new Set(input.candidates.map((candidate) => candidate.semanticGroup))];
  const results = await Promise.allSettled(
    semanticGroups.map((semanticGroup) => (
      isTopicOnCooldownForK(input.db, input.childId, semanticGroup)
    )),
  );
  const blockedGroups = new Set<string>();
  results.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value) {
      blockedGroups.add(semanticGroups[index]);
    } else if (result.status === "rejected") {
      console.error("[mission-v3/questionBank] cooldown lookup rejected", result.reason);
    }
  });
  return input.candidates.filter((candidate) => !blockedGroups.has(candidate.semanticGroup));
};

export const loadMissionQuestionGoalCandidates = async (input: {
  db: SupabaseClient;
  childId: string;
  grade: number;
  weekday: MissionWeekday;
}): Promise<MissionQuestionGoalCandidate[]> => {
  if (!Number.isInteger(input.grade) || input.grade < 1 || input.grade > 6) {
    throw new Error("미션 질문은행 조회 학년은 1~6이어야 합니다.");
  }

  const questionQuery = input.db
    .from("mission_questions")
    .select(
      "id, question_text, applicable_grades, semantic_group, cooldown_days, weekday_affinity, topic, conversation_style, fun_type, memory_usable, sensitivity, answer_mode, periodicity",
    )
    .eq("is_active", true)
    .eq("clinical_status", "APPROVED")
    .contains("applicable_grades", [input.grade])
    .order("created_at", { ascending: true })
    .limit(1000);

  const settled = await Promise.allSettled([
    questionQuery,
    fetchRecentTopics(input.db, input.childId, 100),
  ]);
  const questionResult = settled[0];
  if (questionResult.status === "rejected") {
    throw new Error(`미션 질문은행 조회 실패: ${String(questionResult.reason)}`);
  }
  if (questionResult.value.error) {
    throw new Error(`미션 질문은행 조회 실패: ${questionResult.value.error.message}`);
  }

  const recentTopics = settled[1].status === "fulfilled" ? settled[1].value : [];
  if (settled[1].status === "rejected") {
    console.error("[mission-v3/questionBank] recent topic lookup rejected", settled[1].reason);
  }
  const recentRank = new Map(
    recentTopics.map((topic, index) => [normalizeSemanticGroup(topic.semanticGroup), index]),
  );

  const candidates = ((questionResult.value.data ?? []) as MissionQuestionDbRow[])
    .map(toMetadataRow)
    .map((question) => toGoalCandidate(question, input.weekday))
    .sort((left, right) => {
      const priorityDifference = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
      if (priorityDifference !== 0) return priorityDifference;
      const leftRecentRank = recentRank.get(left.semanticGroup) ?? Number.MAX_SAFE_INTEGER;
      const rightRecentRank = recentRank.get(right.semanticGroup) ?? Number.MAX_SAFE_INTEGER;
      return rightRecentRank - leftRecentRank;
    });

  return filterQuestionCandidatesByCooldown({
    db: input.db,
    childId: input.childId,
    candidates,
    initiatedBy: "k",
  });
};

/** 호출부가 K의 질문 제안을 실제 발화에 반영한 시점에만 사용한다. */
export const recordMissionQuestionTopicUsage = async (input: {
  db: SupabaseClient;
  childId: string;
  candidate: Pick<MissionQuestionGoalCandidate, "semanticGroup" | "cooldownDays">;
  initiatedBy: TopicInitiator;
}): Promise<void> => recordTopicUsage(
  input.db,
  input.childId,
  input.candidate.semanticGroup,
  "mission",
  input.initiatedBy,
  input.candidate.cooldownDays,
);
