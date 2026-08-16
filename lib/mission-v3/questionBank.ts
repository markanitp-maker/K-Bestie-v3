import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchRecentTopics,
  isTopicOnCooldownForK,
  recordTopicUsage,
  type TopicInitiator,
} from "@/lib/k-conversation/semanticTopicHistory";
import type { GoalCandidate } from "@/lib/mission-v3/goalEngine";

import type { RelationshipCalendarStage } from "@/lib/relationship/calendarStage";

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

export const toMetadataRow = (row: MissionQuestionDbRow): MissionQuestionMetadataRow => ({
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
 * 078 Phase 1 우선순위 분류:
 * 1) 관계단계/친해지기 (W1 초기: sensitivity low)
 * 2) 요일·생활맥락 (오늘 요일 일치)
 * 3) 최근 관심사/기억 (memoryUsable)
 * 4) 주기 (periodicity !== 'flexible')
 * 5) 일반
 */
export const getCandidateTier = (
  question: Pick<MissionQuestionMetadataRow, "weekdayAffinity" | "periodicity" | "sensitivity" | "memoryUsable">,
  weekday: MissionWeekday,
  effectiveStage?: RelationshipCalendarStage | null,
): number => {
  if (effectiveStage === "W1" && question.sensitivity === "low") {
    return 1;
  }
  if (question.weekdayAffinity?.includes(weekday)) {
    return 2;
  }
  if (question.memoryUsable) {
    return 3;
  }
  if (question.periodicity && question.periodicity !== "flexible") {
    return 4;
  }
  return 5;
};

/**
 * Phase 1 GoalCandidate 계약을 만족시키는 질문은행 adapter다.
 * - W1: 친해지기(low sensitivity) P1, 요일/기억 P2, 주기/일반 P3
 * - W1 외 / null: 요일 P1, 기억/주기 P2, 일반 P3 (요일이 주기보다 위)
 */
export const toGoalCandidate = (
  question: MissionQuestionMetadataRow,
  weekday: MissionWeekday,
  effectiveStage?: RelationshipCalendarStage | null,
): MissionQuestionGoalCandidate => {
  const tier = getCandidateTier(question, weekday, effectiveStage);
  let priority: GoalCandidate["priority"];
  if (effectiveStage === "W1") {
    if (tier === 1) {
      priority = "P1";
    } else if (tier === 2 || tier === 3) {
      priority = "P2";
    } else {
      priority = "P3";
    }
  } else {
    if (tier === 2) {
      priority = "P1";
    } else if (tier === 3 || tier === 4) {
      priority = "P2";
    } else {
      priority = "P3";
    }
  }

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

/**
 * applyCooldown=false는 "이번 세션에 이미 확정 저장된 Goal의 instruction을 복원"하는
 * 용도 전용이다(2026-08-16 Production 장애). 신규 Goal 선택 경로는 기본값 그대로
 * cooldown을 적용하되, non-cooldown 후보를 우선 채우고 부족하면 cooldown 후보를
 * 마지막 사용이 가장 오래된 순으로 backfill하여 10개 불변식을 지킨다.
 */
export const loadMissionQuestionGoalCandidates = async (input: {
  db: SupabaseClient;
  childId: string;
  grade: number;
  weekday: MissionWeekday;
  effectiveStage?: RelationshipCalendarStage | null;
  applyCooldown?: boolean;
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
  const lastUsedMap = new Map(
    recentTopics.map((topic) => [normalizeSemanticGroup(topic.semanticGroup), topic.lastUsedAt]),
  );

  const metadataRows = ((questionResult.value.data ?? []) as MissionQuestionDbRow[])
    .map(toMetadataRow);

  const candidateItems = metadataRows.map((question) => ({
    candidate: toGoalCandidate(question, input.weekday, input.effectiveStage),
    rawQuestion: question,
  }));

  const sortAvailable = (
    items: Array<{ candidate: MissionQuestionGoalCandidate; rawQuestion: MissionQuestionMetadataRow }>,
  ) => {
    items.sort((left, right) => {
      // 1) Tier 비교
      const leftTier = getCandidateTier(left.rawQuestion, input.weekday, input.effectiveStage);
      const rightTier = getCandidateTier(right.rawQuestion, input.weekday, input.effectiveStage);
      if (leftTier !== rightTier) return leftTier - rightTier;

      // 2) Priority 비교
      const priorityDifference = PRIORITY_ORDER[left.candidate.priority] - PRIORITY_ORDER[right.candidate.priority];
      if (priorityDifference !== 0) return priorityDifference;

      // 3) W1 단계인 경우 가벼운 질문(low) 최우선
      if (input.effectiveStage === "W1") {
        const sensitivityRank: Record<QuestionSensitivity, number> = { low: 1, medium: 2, high: 3 };
        const sensDiff = sensitivityRank[left.candidate.sensitivity] - sensitivityRank[right.candidate.sensitivity];
        if (sensDiff !== 0) return sensDiff;
      }

      // 4) 덜 최근에 사용된 topic 우선
      const leftRecentRank = recentRank.get(left.candidate.semanticGroup) ?? Number.MAX_SAFE_INTEGER;
      const rightRecentRank = recentRank.get(right.candidate.semanticGroup) ?? Number.MAX_SAFE_INTEGER;
      return rightRecentRank - leftRecentRank;
    });
  };

  if (input.applyCooldown === false) {
    sortAvailable(candidateItems);
    return candidateItems.map((item) => item.candidate);
  }

  const uniqueGroups = [...new Set(candidateItems.map((item) => item.candidate.semanticGroup))];
  const cooldownSettled = await Promise.allSettled(
    uniqueGroups.map((semanticGroup) => isTopicOnCooldownForK(input.db, input.childId, semanticGroup)),
  );
  const blockedGroups = new Set<string>();
  cooldownSettled.forEach((res, index) => {
    if (res.status === "fulfilled" && res.value) {
      blockedGroups.add(uniqueGroups[index]);
    } else if (res.status === "rejected") {
      console.error("[mission-v3/questionBank] cooldown lookup rejected", res.reason);
    }
  });

  const available: typeof candidateItems = [];
  const onCooldown: typeof candidateItems = [];

  for (const item of candidateItems) {
    if (blockedGroups.has(item.candidate.semanticGroup)) {
      onCooldown.push(item);
    } else {
      available.push(item);
    }
  }

  // 1) Non-cooldown 후보는 우선순위 티어 순으로 정렬
  sortAvailable(available);

  // 2) Cooldown 후보는 마지막 사용이 가장 오래된 순으로 정렬
  onCooldown.sort((left, right) => {
    const leftLastUsed = lastUsedMap.get(left.candidate.semanticGroup);
    const rightLastUsed = lastUsedMap.get(right.candidate.semanticGroup);
    const leftTime = leftLastUsed ? new Date(leftLastUsed).getTime() : 0;
    const rightTime = rightLastUsed ? new Date(rightLastUsed).getTime() : 0;
    if (leftTime !== rightTime) return leftTime - rightTime; // ascending: 오래된 순
    const leftTier = getCandidateTier(left.rawQuestion, input.weekday, input.effectiveStage);
    const rightTier = getCandidateTier(right.rawQuestion, input.weekday, input.effectiveStage);
    return leftTier - rightTier;
  });

  const cooldownCandidates = onCooldown.map((item) => ({
    ...item.candidate,
    priority: "P3" as const,
  }));

  return [...available.map((item) => item.candidate), ...cooldownCandidates];
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
