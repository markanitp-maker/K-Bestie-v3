import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchRecentTopics,
  isTopicOnCooldownForK,
  recordTopicUsage,
  type TopicInitiator,
} from "@/lib/k-conversation/semanticTopicHistory";
import type { GoalCandidate } from "@/lib/mission-v3/goalEngine";
import {
  getActiveVacationContext,
  resolveSchoolQuestionBlockState,
} from "@/lib/plan/vacationSchoolContext";
import type { RelationshipCalendarStage } from "@/lib/relationship/calendarStage";
import { getKstBusinessDate } from "@/lib/utils/kstBusinessDate";

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
  questionFamily?: string | null;
  schoolContextTag?: string | null;
}

export interface MissionQuestionGoalCandidate extends GoalCandidate {
  questionId: string;
  questionText: string;
  cooldownDays: number;
  topic: string;
  memoryUsable: boolean;
  sensitivity: QuestionSensitivity;
  questionFamily?: string | null;
  schoolContextTag?: string | null;
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
  question_family?: string | null;
  school_context_tag?: string | null;
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
  weekdayAffinity: toWeekdays(row.weekday_affinity ?? []),
  topic: row.topic,
  conversationStyle: row.conversation_style,
  funType: row.fun_type,
  memoryUsable: row.memory_usable,
  sensitivity: row.sensitivity,
  answerMode: row.answer_mode,
  periodicity: row.periodicity,
  questionFamily: row.question_family ?? null,
  schoolContextTag: row.school_context_tag ?? null,
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
    questionFamily: question.questionFamily ?? null,
    schoolContextTag: question.schoolContextTag ?? null,
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

const EMERGENCY_FALLBACK_QUESTIONS: Array<{
  semanticGroup: string;
  topic: string;
  questionText: string;
  conversationStyle: string;
  answerMode: string;
  questionFamily: string;
}> = [
  {
    semanticGroup: "RAPPORT_IDENTITY",
    topic: "rapport_name",
    questionText: "케이는 너랑 친해지고 싶은데, 뭐라고 불러주면 좋아?",
    conversationStyle: "permission_first",
    answerMode: "short_open",
    questionFamily: "RAPPORT_PREFERENCE",
  },
  {
    semanticGroup: "DAILY_HIGHLIGHT",
    topic: "daily_highlight",
    questionText: "오늘 하루 중 제일 재미있었던 순간이 언제야?",
    conversationStyle: "open_story",
    answerMode: "open",
    questionFamily: "DAILY_HIGHLIGHT",
  },
  {
    semanticGroup: "INTEREST_AND_PREFERENCE",
    topic: "interest_play",
    questionText: "요즘 제일 자주 하거나 좋아하는 놀이가 뭐야?",
    conversationStyle: "child_as_expert",
    answerMode: "open",
    questionFamily: "RAPPORT_INTEREST",
  },
  {
    semanticGroup: "DIGITAL_CONTENT",
    topic: "game_digital",
    questionText: "요즘 자주 하는 게임이나 재미있게 보는 영상 있어?",
    conversationStyle: "child_as_expert",
    answerMode: "open",
    questionFamily: "GAME_TODAY",
  },
  {
    semanticGroup: "PEER_CONNECTION",
    topic: "peer_friend",
    questionText: "오늘 친구들이랑 쉬는 시간에 뭐 하고 놀았어?",
    conversationStyle: "open_story",
    answerMode: "open",
    questionFamily: "FRIEND_PLAY",
  },
  {
    semanticGroup: "LEARNING_AND_STUDY",
    topic: "learning_study",
    questionText: "오늘 학교나 학원에서 배운 것 중 기억나는 거 있어?",
    conversationStyle: "reflective",
    answerMode: "open",
    questionFamily: "ACADEMY_LEARNING",
  },
  {
    semanticGroup: "MEAL_AND_TASTE",
    topic: "meal_taste",
    questionText: "오늘 먹은 음식이나 간식 중에 제일 맛있었던 건 뭐야?",
    conversationStyle: "open_story",
    answerMode: "open",
    questionFamily: "FOOD_TODAY",
  },
  {
    semanticGroup: "MOOD_CHECK",
    topic: "mood_check",
    questionText: "오늘 기분이나 컨디션은 어땠어?",
    conversationStyle: "reflective",
    answerMode: "open",
    questionFamily: "MOOD_TODAY",
  },
  {
    semanticGroup: "HOBBY_AND_CREATION",
    topic: "hobby_creation",
    questionText: "자유시간이 생기면 주로 뭐 하면서 시간 보내?",
    conversationStyle: "child_as_expert",
    answerMode: "open",
    questionFamily: "RAPPORT_INTEREST",
  },
  {
    semanticGroup: "FAMILY_RELATIONSHIP",
    topic: "family_home",
    questionText: "오늘 집에서 가족이랑 무슨 이야기 하거나 같이 한 거 있어?",
    conversationStyle: "reflective",
    answerMode: "open",
    questionFamily: "FAMILY_TODAY",
  },
];

/**
 * 078 Phase B — 7-Day Rotation & Repeat Guard 질문 선택 엔진
 *
 * 1) 최근 7일 동일 question_id: 후보에서 제외 (부족 시 oldest순 완화 backfill)
 * 2) 최근 7일 동일 question_family: 강한 감점 (제외가 아니라 감점, 3일 내는 더 강하게)
 * 3) 첫 질문(goal_order 1)의 family는 7일 내 반복 금지
 * 4) 10 Goal 불변식: 어떤 경우에도 10개 미만 반환 금지 (Stepwise Relaxation)
 * 5) question_family 컬럼 미존재/null 시 fail-open(감점만 생략)
 */
export const loadMissionQuestionGoalCandidates = async (input: {
  db: SupabaseClient;
  childId: string;
  grade: number;
  weekday: MissionWeekday;
  effectiveStage?: RelationshipCalendarStage | null;
  applyCooldown?: boolean;
  now?: Date;
  vacationBlocked?: boolean;
}): Promise<MissionQuestionGoalCandidate[]> => {
  if (!Number.isInteger(input.grade) || input.grade < 1 || input.grade > 6) {
    throw new Error("미션 질문은행 조회 학년은 1~6이어야 합니다.");
  }

  // 1. mission_questions 조회 (question_family, school_context_tag 컬럼 포함 시도, 없으면 폴백)
  let rawQuestions: MissionQuestionDbRow[] = [];
  try {
    const fullQuery = input.db
      .from("mission_questions")
      .select(
        "id, question_text, applicable_grades, semantic_group, cooldown_days, weekday_affinity, topic, conversation_style, fun_type, memory_usable, sensitivity, answer_mode, periodicity, question_family, school_context_tag",
      )
      .eq("is_active", true)
      .eq("clinical_status", "APPROVED")
      .contains("applicable_grades", [input.grade])
      .order("created_at", { ascending: true })
      .limit(1000);

    const fullResult = await fullQuery;
    if (fullResult.error) {
      // 1차 폴백: question_family만 포함 시도
      const fallbackQuery1 = input.db
        .from("mission_questions")
        .select(
          "id, question_text, applicable_grades, semantic_group, cooldown_days, weekday_affinity, topic, conversation_style, fun_type, memory_usable, sensitivity, answer_mode, periodicity, question_family",
        )
        .eq("is_active", true)
        .eq("clinical_status", "APPROVED")
        .contains("applicable_grades", [input.grade])
        .order("created_at", { ascending: true })
        .limit(1000);
      const fallbackResult1 = await fallbackQuery1;
      if (fallbackResult1.error) {
        // 2차 폴백: 기본 컬럼만 조회
        const fallbackQuery2 = input.db
          .from("mission_questions")
          .select(
            "id, question_text, applicable_grades, semantic_group, cooldown_days, weekday_affinity, topic, conversation_style, fun_type, memory_usable, sensitivity, answer_mode, periodicity",
          )
          .eq("is_active", true)
          .eq("clinical_status", "APPROVED")
          .contains("applicable_grades", [input.grade])
          .order("created_at", { ascending: true })
          .limit(1000);
        const fallbackResult2 = await fallbackQuery2;
        if (fallbackResult2.error) {
          throw new Error(`미션 질문은행 조회 실패: ${fallbackResult2.error.message}`);
        }
        rawQuestions = (fallbackResult2.data ?? []) as MissionQuestionDbRow[];
      } else {
        rawQuestions = (fallbackResult1.data ?? []) as MissionQuestionDbRow[];
      }
    } else {
      rawQuestions = (fullResult.data ?? []) as MissionQuestionDbRow[];
    }
  } catch (error) {
    throw new Error(`미션 질문은행 조회 실패: ${String(error)}`);
  }

  const metadataRows = rawQuestions.map(toMetadataRow);
  const metadataQuestionMap = new Map(metadataRows.map((q) => [q.id, q]));

  const candidateItems = metadataRows.map((question) => ({
    candidate: toGoalCandidate(question, input.weekday, input.effectiveStage),
    rawQuestion: question,
  }));

  const sortDefaultPriority = (
    items: Array<{ candidate: MissionQuestionGoalCandidate; rawQuestion: MissionQuestionMetadataRow }>,
    recentRank: Map<string, number>,
  ) => {
    items.sort((left, right) => {
      const leftTier = getCandidateTier(left.rawQuestion, input.weekday, input.effectiveStage);
      const rightTier = getCandidateTier(right.rawQuestion, input.weekday, input.effectiveStage);
      if (leftTier !== rightTier) return leftTier - rightTier;

      const priorityDiff = PRIORITY_ORDER[left.candidate.priority] - PRIORITY_ORDER[right.candidate.priority];
      if (priorityDiff !== 0) return priorityDiff;

      if (input.effectiveStage === "W1") {
        const sensitivityRank: Record<QuestionSensitivity, number> = { low: 1, medium: 2, high: 3 };
        const sensDiff = sensitivityRank[left.candidate.sensitivity] - sensitivityRank[right.candidate.sensitivity];
        if (sensDiff !== 0) return sensDiff;
      }

      const leftRecent = recentRank.get(left.candidate.semanticGroup) ?? Number.MAX_SAFE_INTEGER;
      const rightRecent = recentRank.get(right.candidate.semanticGroup) ?? Number.MAX_SAFE_INTEGER;
      return rightRecent - leftRecent;
    });
  };

  // applyCooldown=false는 확정 Goal instruction 복원 전용
  if (input.applyCooldown === false) {
    sortDefaultPriority(candidateItems, new Map());
    return candidateItems.map((item) => item.candidate);
  }

  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const businessDate = getKstBusinessDate(now);

  // 2. 비동기 병렬 조회: 최근 토픽 이력, 쿨다운 상태, 최근 7일 mission_progress 이력, 방학 컨텍스트
  const uniqueGroups = [...new Set(candidateItems.map((item) => item.candidate.semanticGroup))];
  const [topicsResult, cooldownResult, progressResult, vacationResult] = await Promise.allSettled([
    fetchRecentTopics(input.db, input.childId, 100),
    Promise.allSettled(
      uniqueGroups.map((semanticGroup) => isTopicOnCooldownForK(input.db, input.childId, semanticGroup)),
    ),
    input.db
      .from("mission_progress")
      .select("session_id, question_ids, created_at, business_date")
      .eq("child_id", input.childId)
      .order("created_at", { ascending: false })
      .limit(14),
    input.vacationBlocked !== undefined
      ? Promise.resolve(null)
      : getActiveVacationContext(input.db, input.childId),
  ]);

  let isVacationBlocked = false;
  if (input.vacationBlocked !== undefined) {
    isVacationBlocked = input.vacationBlocked;
  } else if (vacationResult.status === "fulfilled" && vacationResult.value) {
    const blockState = resolveSchoolQuestionBlockState(vacationResult.value, businessDate);
    isVacationBlocked = blockState.blocked;
  } else {
    isVacationBlocked = false;
  }

  const recentTopics = topicsResult.status === "fulfilled" ? topicsResult.value : [];
  const recentRank = new Map(
    recentTopics.map((topic, index) => [normalizeSemanticGroup(topic.semanticGroup), index]),
  );
  const lastUsedMap = new Map(
    recentTopics.map((topic) => [normalizeSemanticGroup(topic.semanticGroup), topic.lastUsedAt]),
  );

  const blockedGroups = new Set<string>();
  if (cooldownResult.status === "fulfilled") {
    cooldownResult.value.forEach((res, index) => {
      if (res.status === "fulfilled" && res.value) {
        blockedGroups.add(uniqueGroups[index]);
      }
    });
  }

  // 3. 최근 7일/3일 mission_progress 이력 분석
  const usedQuestionIds7dMap = new Map<string, number>(); // qid -> 가장 최근 사용 시각
  const usedQuestionIds3d = new Set<string>();
  const firstQuestionFamilies7d = new Set<string>();
  const firstQuestionSemanticGroups3d = new Set<string>();
  const recentFamilies7d = new Set<string>();
  const recentFamilies3d = new Set<string>();

  if (progressResult.status === "fulfilled" && !progressResult.value.error && Array.isArray(progressResult.value.data)) {
    const rows = progressResult.value.data;
    rows.forEach((row, rowIndex) => {
      const rowCreatedAt = row.created_at ? new Date(row.created_at).getTime() : nowMs;
      const rowAgeMs = nowMs - (Number.isFinite(rowCreatedAt) ? rowCreatedAt : nowMs);
      const isWithin7d = rowAgeMs <= 7 * 86_400_000 + 3_600_000 || rowIndex < 7;
      const isWithin3d = rowAgeMs <= 3 * 86_400_000 + 3_600_000 || rowIndex < 3;

      const qids = Array.isArray(row.question_ids) ? row.question_ids : [];
      if (qids.length > 0) {
        const firstQid = qids[0];
        const firstMeta = metadataQuestionMap.get(firstQid);
        if (isWithin7d && firstMeta?.questionFamily) {
          firstQuestionFamilies7d.add(firstMeta.questionFamily);
        }
        if (isWithin3d && firstMeta?.semanticGroup) {
          firstQuestionSemanticGroups3d.add(firstMeta.semanticGroup);
        }

        for (const qid of qids) {
          const meta = metadataQuestionMap.get(qid);
          if (isWithin7d) {
            usedQuestionIds7dMap.set(qid, Math.max(usedQuestionIds7dMap.get(qid) ?? 0, rowCreatedAt));
            if (meta?.questionFamily) {
              recentFamilies7d.add(meta.questionFamily);
            }
          }
          if (isWithin3d) {
            usedQuestionIds3d.add(qid);
            if (meta?.questionFamily) {
              recentFamilies3d.add(meta.questionFamily);
            }
          }
        }
      }
    });
  }

  // 4. 후보군 분류 (Pool A: 신규 후보, Pool B: 7일 중복 후보, Pool C: 쿨다운 후보)
  // 방학 차단 활성화 시 school_required 질문은 Pool A/B/C 어디에도 포함되지 않는다 (완화 단계에서도 절대 부활 방지)
  const poolA: typeof candidateItems = [];
  const poolB: typeof candidateItems = [];
  const poolC: typeof candidateItems = [];

  for (const item of candidateItems) {
    if (isVacationBlocked && item.rawQuestion.schoolContextTag === "school_required") {
      continue;
    }
    const is7DayRepeat = usedQuestionIds7dMap.has(item.candidate.questionId);
    const isOnCooldown = blockedGroups.has(item.candidate.semanticGroup);

    if (isOnCooldown) {
      poolC.push(item);
    } else if (is7DayRepeat) {
      poolB.push(item);
    } else {
      poolA.push(item);
    }
  }

  // 5. Pool A (신규 후보) 정렬: family 감점 + 티어 + 우선순위
  poolA.sort((left, right) => {
    // 1) 동일 question_family 감점: 최근 3일(+200) > 최근 7일(+100) > 감점 없음(0)
    const leftFam = left.rawQuestion.questionFamily;
    const rightFam = right.rawQuestion.questionFamily;
    const leftPenalty = leftFam
      ? (recentFamilies3d.has(leftFam) ? 200 : (recentFamilies7d.has(leftFam) ? 100 : 0))
      : 0;
    const rightPenalty = rightFam
      ? (recentFamilies3d.has(rightFam) ? 200 : (recentFamilies7d.has(rightFam) ? 100 : 0))
      : 0;
    if (leftPenalty !== rightPenalty) return leftPenalty - rightPenalty;

    // 2) Tier 비교
    const leftTier = getCandidateTier(left.rawQuestion, input.weekday, input.effectiveStage);
    const rightTier = getCandidateTier(right.rawQuestion, input.weekday, input.effectiveStage);
    if (leftTier !== rightTier) return leftTier - rightTier;

    // 3) Priority 비교
    const priorityDiff = PRIORITY_ORDER[left.candidate.priority] - PRIORITY_ORDER[right.candidate.priority];
    if (priorityDiff !== 0) return priorityDiff;

    // 4) W1: 저감도(low sensitivity) 우선
    if (input.effectiveStage === "W1") {
      const sensRank: Record<QuestionSensitivity, number> = { low: 1, medium: 2, high: 3 };
      const sensDiff = sensRank[left.candidate.sensitivity] - sensRank[right.candidate.sensitivity];
      if (sensDiff !== 0) return sensDiff;
    }

    // 5) 덜 최근에 사용된 semantic_group 우선
    const leftRecent = recentRank.get(left.candidate.semanticGroup) ?? Number.MAX_SAFE_INTEGER;
    const rightRecent = recentRank.get(right.candidate.semanticGroup) ?? Number.MAX_SAFE_INTEGER;
    return rightRecent - leftRecent;
  });

  // 첫 질문(goal_order 1)의 family 7일 내 반복 방지 및 최근 3일 첫 질문 semantic_group 방지
  if (poolA.length > 1) {
    const firstItem = poolA[0];
    const violatesFamily = firstItem.rawQuestion.questionFamily && firstQuestionFamilies7d.has(firstItem.rawQuestion.questionFamily);
    const violatesSg = firstQuestionSemanticGroups3d.has(firstItem.candidate.semanticGroup);

    if (violatesFamily || violatesSg) {
      const validIndex = poolA.findIndex((item, idx) => {
        if (idx === 0) return false;
        const famOk = !item.rawQuestion.questionFamily || !firstQuestionFamilies7d.has(item.rawQuestion.questionFamily);
        const sgOk = !firstQuestionSemanticGroups3d.has(item.candidate.semanticGroup);
        return famOk && sgOk;
      });
      if (validIndex > 0) {
        const [promoted] = poolA.splice(validIndex, 1);
        poolA.unshift(promoted);
      }
    }
  }

  // 6. Pool B (7일 중복 후보) 정렬: 가장 오래전에 사용된 것부터 (Step 1 완화)
  poolB.sort((left, right) => {
    const leftUsedTime = usedQuestionIds7dMap.get(left.candidate.questionId) ?? 0;
    const rightUsedTime = usedQuestionIds7dMap.get(right.candidate.questionId) ?? 0;
    if (leftUsedTime !== rightUsedTime) return leftUsedTime - rightUsedTime;

    const leftTier = getCandidateTier(left.rawQuestion, input.weekday, input.effectiveStage);
    const rightTier = getCandidateTier(right.rawQuestion, input.weekday, input.effectiveStage);
    return leftTier - rightTier;
  });

  // 7. Pool C (쿨다운 후보) 정렬: 가장 오래전에 사용된 것부터 (Step 3 완화)
  poolC.sort((left, right) => {
    const leftLastUsed = lastUsedMap.get(left.candidate.semanticGroup);
    const rightLastUsed = lastUsedMap.get(right.candidate.semanticGroup);
    const leftTime = leftLastUsed ? new Date(leftLastUsed).getTime() : 0;
    const rightTime = rightLastUsed ? new Date(rightLastUsed).getTime() : 0;
    if (leftTime !== rightTime) return leftTime - rightTime;

    const leftTier = getCandidateTier(left.rawQuestion, input.weekday, input.effectiveStage);
    const rightTier = getCandidateTier(right.rawQuestion, input.weekday, input.effectiveStage);
    return leftTier - rightTier;
  });

  // 8. 단계적 완화 (Stepwise Relaxation) & 10 Goal 불변식 보장
  let relaxationLevel = 0;
  const combinedCandidates: MissionQuestionGoalCandidate[] = [];
  const seenSemanticGroups = new Set<string>();

  // Step 0: 신규 후보군 투입
  for (const item of poolA) {
    combinedCandidates.push(item.candidate);
    seenSemanticGroups.add(item.candidate.semanticGroup);
  }

  // Step 1: 10개 미달 시 7일 제외 대상 중 가장 오래된 순으로 backfill
  if (seenSemanticGroups.size < 10 && poolB.length > 0) {
    relaxationLevel = Math.max(relaxationLevel, 1);
    for (const item of poolB) {
      combinedCandidates.push({
        ...item.candidate,
        priority: "P3",
      });
      seenSemanticGroups.add(item.candidate.semanticGroup);
    }
  }

  // Step 2 & 3: 여전히 10개 미달 시 쿨다운 후보 중 가장 오래된 순으로 backfill
  if (seenSemanticGroups.size < 10 && poolC.length > 0) {
    relaxationLevel = Math.max(relaxationLevel, 3);
    for (const item of poolC) {
      combinedCandidates.push({
        ...item.candidate,
        priority: "P3",
      });
      seenSemanticGroups.add(item.candidate.semanticGroup);
    }
  }

  // Step 4: 비상 폴백 (테스트/비정상 DB에서 10개 미달 시 최종 보장)
  if (seenSemanticGroups.size < 10) {
    relaxationLevel = 4;
    for (const fb of EMERGENCY_FALLBACK_QUESTIONS) {
      if (!seenSemanticGroups.has(fb.semanticGroup)) {
        combinedCandidates.push({
          questionId: `fallback-${fb.semanticGroup.toLowerCase()}`,
          questionText: fb.questionText,
          semanticGroup: fb.semanticGroup,
          priority: "P3",
          promptInstruction: `아이의 직전 발화와 자연스럽게 연결해 '${fb.topic}' 주제를 탐색해. 질문은행 문장 '${fb.questionText}'의 의미를 유지하되 대화 흐름에 맞게 자연스럽게 표현해. 한 번에 질문은 하나만 하고 답을 평가하지 마.`,
          cooldownDays: 3,
          topic: fb.topic,
          memoryUsable: false,
          sensitivity: "low",
          questionFamily: fb.questionFamily,
        });
        seenSemanticGroups.add(fb.semanticGroup);
        if (seenSemanticGroups.size >= 10) break;
      }
    }
  }

  if (relaxationLevel > 0) {
    console.info(`[mission-v3/questionBank] Goal 후보 단계적 완화 적용 (relaxationLevel=${relaxationLevel}, uniqueGroups=${seenSemanticGroups.size})`);
  }

  return combinedCandidates;
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
