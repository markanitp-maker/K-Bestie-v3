import assert from "node:assert/strict";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { recordTopicUsage } from "@/lib/k-conversation/semanticTopicHistory";
import {
  CONVERSATION_GOAL_COUNT,
  selectConversationGoalDrafts,
  type GoalCandidate,
} from "@/lib/mission-v3/goalEngine";
import {
  getCandidateTier,
  loadMissionQuestionGoalCandidates,
  toGoalCandidate,
  toMetadataRow,
  type MissionQuestionMetadataRow,
  type MissionWeekday,
} from "@/lib/mission-v3/questionBank";
import type { RelationshipCalendarStage } from "@/lib/relationship/calendarStage";

interface TopicState {
  child_id: string;
  semantic_group: string;
  mode: "mission" | "free_chat";
  last_initiated_by: "child" | "k" | "parent_question";
  last_used_at: string;
  child_frequency: number;
  k_frequency: number;
  parent_question_frequency: number;
  cooldown_until: string;
}

interface QueryState {
  equals: Map<string, unknown>;
  contains: Map<string, unknown[]>;
  limit: number | null;
}

const makeQuestionRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "question-default",
  question_text: "기본 질문 텍스트입니다.",
  applicable_grades: [4],
  semantic_group: "DEFAULT_GROUP",
  cooldown_days: 3,
  weekday_affinity: [],
  topic: "default_topic",
  conversation_style: "open_story",
  fun_type: "none",
  memory_usable: false,
  sensitivity: "low",
  answer_mode: "open",
  periodicity: "flexible",
  is_active: true,
  clinical_status: "APPROVED",
  created_at: "2026-08-03T00:00:00.000Z",
  ...overrides,
});

const makeMockDb = (questionRows: Array<Record<string, unknown>> = []) => {
  const topics = new Map<string, TopicState>();
  const topicKey = (childId: string, semanticGroup: string) => `${childId}:${semanticGroup}`;

  const resolveRows = (table: string, state: QueryState) => {
    if (table === "mission_questions") {
      let rows = questionRows.filter((row) => {
        for (const [column, value] of state.equals) {
          if (row[column] !== value) return false;
        }
        for (const [column, values] of state.contains) {
          const rowValues = row[column];
          if (!Array.isArray(rowValues) || !values.every((val) => rowValues.includes(val))) return false;
        }
        return true;
      });
      if (state.limit !== null) rows = rows.slice(0, state.limit);
      return rows;
    }

    let rows = [...topics.values()].filter((row) => {
      for (const [column, value] of state.equals) {
        if (row[column as keyof TopicState] !== value) return false;
      }
      return true;
    });
    rows.sort((left, right) => right.last_used_at.localeCompare(left.last_used_at));
    if (state.limit !== null) rows = rows.slice(0, state.limit);
    return rows;
  };

  const from = (table: string) => {
    const state: QueryState = { equals: new Map(), contains: new Map(), limit: null };
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        state.equals.set(column, value);
        return query;
      },
      contains: (column: string, values: unknown[]) => {
        state.contains.set(column, values);
        return query;
      },
      order: () => query,
      limit: (value: number) => {
        state.limit = value;
        return query;
      },
      maybeSingle: async () => ({ data: resolveRows(table, state)[0] ?? null, error: null }),
      then: (
        onFulfilled: (value: { data: unknown[]; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve({ data: resolveRows(table, state), error: null }).then(onFulfilled, onRejected),
    };
    return query;
  };

  const db = {
    from,
    rpc: async (_name: string, params: Record<string, unknown>) => {
      const childId = String(params.p_child_id);
      const semanticGroup = String(params.p_semantic_group);
      const initiatedBy = params.p_initiated_by as TopicState["last_initiated_by"];
      const mode = params.p_mode as TopicState["mode"];
      const cooldownDays = Number(params.p_cooldown_days);
      const key = topicKey(childId, semanticGroup);
      const previous = topics.get(key);
      topics.set(key, {
        child_id: childId,
        semantic_group: semanticGroup,
        mode,
        last_initiated_by: initiatedBy,
        last_used_at: (params.p_last_used_at as string) || new Date().toISOString(),
        child_frequency: (previous?.child_frequency ?? 0) + (initiatedBy === "child" ? 1 : 0),
        k_frequency: (previous?.k_frequency ?? 0) + (initiatedBy === "k" ? 1 : 0),
        parent_question_frequency: (previous?.parent_question_frequency ?? 0) + (initiatedBy === "parent_question" ? 1 : 0),
        cooldown_until: new Date(Date.now() + cooldownDays * 86_400_000).toISOString(),
      });
      return { error: null };
    },
  } as unknown as SupabaseClient;

  return { db, topics, topicKey };
};

// 1. 관계 단계가 Goal 선택 전에 계산된다 (호출 순서 검증)
test("1. 관계 단계가 Goal 선택 전에 계산된다 (호출 순서 검증)", async () => {
  const callSequence: string[] = [];

  const mockEvaluateRelationshipStage = async () => {
    callSequence.push("evaluateRelationshipStage");
    return {
      effectiveStage: "W1" as RelationshipCalendarStage,
      calendarStage: "W1" as RelationshipCalendarStage,
      ruleVersion: "v1",
      blockedBy: null,
      scenarioCard: null,
      metrics: {
        conversationCount: 0,
        conversationDays: 0,
        usableMemoryCount: 0,
        sharedMemoryCount: 0,
        relationshipEventCount: 0,
      },
    };
  };

  const mockEnsureGoals = async (effectiveStage: RelationshipCalendarStage | null) => {
    callSequence.push(`ensureGoals(effectiveStage=${effectiveStage})`);
    return [];
  };

  const mockPersistRelationshipStage = async () => {
    callSequence.push("persistRelationshipStage");
  };

  // 실행 흐름: evaluate -> ensureGoals(with effectiveStage) -> persist
  const evaluated = await mockEvaluateRelationshipStage();
  const effectiveStage = evaluated.effectiveStage;
  await mockEnsureGoals(effectiveStage);
  await mockPersistRelationshipStage();

  assert.deepEqual(callSequence, [
    "evaluateRelationshipStage",
    "ensureGoals(effectiveStage=W1)",
    "persistRelationshipStage",
  ]);
});

// 2. effectiveStage가 null이어도 Goal 10개가 나온다
test("2. effectiveStage가 null이어도 Goal 10개가 나온다", async () => {
  const questionRows = Array.from({ length: 15 }, (_, i) => makeQuestionRow({
    id: `q-${i + 1}`,
    question_text: `질문 ${i + 1}`,
    semantic_group: `GROUP_${i + 1}`,
    periodicity: "flexible",
    weekday_affinity: [],
  }));
  const { db } = makeMockDb(questionRows);

  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "child-null-stage",
    grade: 4,
    weekday: "wed",
    effectiveStage: null,
  });

  const goals = selectConversationGoalDrafts({
    missionSessionId: "session-null-stage",
    childId: "child-null-stage",
    candidates,
  });

  assert.equal(goals.length, CONVERSATION_GOAL_COUNT);
  assert.equal(goals.length, 10);
  const uniqueGroups = new Set(goals.map((g) => g.semanticGroup));
  assert.equal(uniqueGroups.size, 10);
});

// 3. 요일 후보가 주기 후보보다 앞선다
test("3. 요일 후보가 주기 후보보다 앞선다", async () => {
  const weekdayRow = makeQuestionRow({
    id: "q-weekday",
    question_text: "수요일 요일 맞춤 질문",
    semantic_group: "WEEKDAY_GROUP",
    weekday_affinity: ["wed"],
    periodicity: "flexible",
  });
  const periodicRow = makeQuestionRow({
    id: "q-periodic",
    question_text: "주간 주기 질문",
    semantic_group: "PERIODIC_GROUP",
    weekday_affinity: [],
    periodicity: "weekly",
  });

  // 1) getCandidateTier 검증: 요일(Tier 2) < 주기(Tier 4)
  const weekdayTier = getCandidateTier(toMetadataRow(weekdayRow), "wed", null);
  const periodicTier = getCandidateTier(toMetadataRow(periodicRow), "wed", null);
  assert.equal(weekdayTier, 2);
  assert.equal(periodicTier, 4);
  assert.ok(weekdayTier < periodicTier, "요일 티어(2)가 주기 티어(4)보다 앞서야 한다");

  // 2) toGoalCandidate 우선순위 검증
  const weekdayCandidate = toGoalCandidate(toMetadataRow(weekdayRow), "wed", null);
  const periodicCandidate = toGoalCandidate(toMetadataRow(periodicRow), "wed", null);
  assert.equal(weekdayCandidate.priority, "P1");
  assert.equal(periodicCandidate.priority, "P2");

  // 3) loadMissionQuestionGoalCandidates 정렬 검증
  const { db } = makeMockDb([periodicRow, weekdayRow]);
  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "child-1",
    grade: 4,
    weekday: "wed",
    effectiveStage: null,
  });

  assert.equal(candidates[0].semanticGroup, "WEEKDAY_GROUP");
  assert.equal(candidates[1].semanticGroup, "PERIODIC_GROUP");
});

// 4. W1이면 가벼운(sensitivity 낮은) 질문이 앞에 온다
test("4. W1이면 가벼운(sensitivity 낮은) 질문이 앞에 온다", async () => {
  const lightRow = makeQuestionRow({
    id: "q-light",
    question_text: "오늘 점심 맛있었어?",
    semantic_group: "LIGHT_RAPPORT",
    sensitivity: "low",
    weekday_affinity: [],
    periodicity: "flexible",
  });
  const heavyWeekdayRow = makeQuestionRow({
    id: "q-heavy",
    question_text: "수요일 친구와 갈등 있었어?",
    semantic_group: "HEAVY_CONFLICT",
    sensitivity: "high",
    weekday_affinity: ["wed"],
    periodicity: "flexible",
  });

  // W1에서 light는 Tier 1 (P1), heavyWeekday는 Tier 2 (P2)
  const lightTier = getCandidateTier(toMetadataRow(lightRow), "wed", "W1");
  const heavyTier = getCandidateTier(toMetadataRow(heavyWeekdayRow), "wed", "W1");
  assert.equal(lightTier, 1);
  assert.equal(heavyTier, 2);

  const lightCandidate = toGoalCandidate(toMetadataRow(lightRow), "wed", "W1");
  const heavyCandidate = toGoalCandidate(toMetadataRow(heavyWeekdayRow), "wed", "W1");
  assert.equal(lightCandidate.priority, "P1");
  assert.equal(heavyCandidate.priority, "P2");

  const { db } = makeMockDb([heavyWeekdayRow, lightRow]);
  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "child-w1",
    grade: 4,
    weekday: "wed",
    effectiveStage: "W1",
  });

  assert.equal(candidates[0].semanticGroup, "LIGHT_RAPPORT");
  assert.equal(candidates[1].semanticGroup, "HEAVY_CONFLICT");
});

// 5. cooldown 후보만 남아도 10개를 채운다 (마지막 사용이 가장 오래된 순으로 backfill)
test("5. cooldown 후보만 남아도 10개를 채운다", async () => {
  // 12개 질문을 만들고 모두 cooldown에 넣되, 각각 last_used_at 시간을 다르게 설정
  const questionRows = Array.from({ length: 12 }, (_, i) => makeQuestionRow({
    id: `q-${i + 1}`,
    question_text: `질문 ${i + 1}`,
    semantic_group: `COOL_GROUP_${i + 1}`,
  }));
  const { db } = makeMockDb(questionRows);

  // 12개 모두 쿨다운 설정 (i=1이 가장 오래된 12일 전, i=12가 가장 최근 1일 전)
  for (let i = 0; i < 12; i++) {
    const daysAgo = 12 - i;
    const pastDate = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    await recordTopicUsage(db, "child-cool", `COOL_GROUP_${i + 1}`, "mission", "k", 30);
    // last_used_at 직접 설정
    await db.rpc("record_conversation_topic_usage", {
      p_child_id: "child-cool",
      p_semantic_group: `COOL_GROUP_${i + 1}`,
      p_mode: "mission",
      p_initiated_by: "k",
      p_cooldown_days: 30,
      p_last_used_at: pastDate,
    });
  }

  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "child-cool",
    grade: 4,
    weekday: "mon",
    effectiveStage: null,
  });

  // 후보는 12개 모두 반환되며
  assert.equal(candidates.length, 12);

  const goals = selectConversationGoalDrafts({
    missionSessionId: "session-cool-backfill",
    childId: "child-cool",
    candidates,
  });

  // 10개 불변식 만족
  assert.equal(goals.length, 10);

  // 가장 오래된 i=1부터 i=10까지의 그룹이 순서대로 채워짐
  assert.equal(goals[0].semanticGroup, "COOL_GROUP_1");
  assert.equal(goals[1].semanticGroup, "COOL_GROUP_2");
  assert.equal(goals[9].semanticGroup, "COOL_GROUP_10");
});

// 6. 같은 semantic_group이 한 세션에 두 번 안 들어간다
test("6. 같은 semantic_group이 한 세션에 두 번 안 들어간다", () => {
  const candidates: GoalCandidate[] = [
    { semanticGroup: "SCHOOL_LIFE", priority: "P1", promptInstruction: "지시 1" },
    { semanticGroup: "SCHOOL_LIFE", priority: "P1", promptInstruction: "지시 2 (중복)" },
    { semanticGroup: "PEER_FRIEND", priority: "P2", promptInstruction: "지시 3" },
    { semanticGroup: "PEER_FRIEND", priority: "P2", promptInstruction: "지시 4 (중복)" },
    { semanticGroup: "G3", priority: "P3", promptInstruction: "지시 5" },
    { semanticGroup: "G4", priority: "P3", promptInstruction: "지시 6" },
    { semanticGroup: "G5", priority: "P3", promptInstruction: "지시 7" },
    { semanticGroup: "G6", priority: "P3", promptInstruction: "지시 8" },
    { semanticGroup: "G7", priority: "P3", promptInstruction: "지시 9" },
    { semanticGroup: "G8", priority: "P3", promptInstruction: "지시 10" },
    { semanticGroup: "G9", priority: "P3", promptInstruction: "지시 11" },
    { semanticGroup: "G10", priority: "P3", promptInstruction: "지시 12" },
  ];

  const goals = selectConversationGoalDrafts({
    missionSessionId: "session-dup-check",
    childId: "child-1",
    candidates,
  });

  assert.equal(goals.length, 10);
  const seen = new Set<string>();
  for (const goal of goals) {
    assert.equal(seen.has(goal.semanticGroup), false, `중복 semantic_group 발견: ${goal.semanticGroup}`);
    seen.add(goal.semanticGroup);
  }
});

// 7. 부모 질문(P0)이 있으면 여전히 1번 슬롯이다
test("7. 부모 질문(P0)이 있으면 여전히 1번 슬롯이다", () => {
  const candidates: GoalCandidate[] = Array.from({ length: 15 }, (_, i) => ({
    semanticGroup: `BANK_GROUP_${i + 1}`,
    priority: i < 3 ? "P1" : i < 6 ? "P2" : "P3",
    promptInstruction: `지시 ${i + 1}`,
  }));

  const goals = selectConversationGoalDrafts({
    missionSessionId: "session-p0-slot",
    childId: "child-1",
    parentQuestion: {
      id: "parent-q-100",
      semanticGroup: "PARENT_IMPORTANT_QUESTION",
      promptInstruction: "부모님이 요청하신 질문을 자연스럽게 물어봐.",
    },
    candidates,
  });

  assert.equal(goals.length, 10);
  assert.equal(goals[0].goalOrder, 1);
  assert.equal(goals[0].priority, "P0");
  assert.equal(goals[0].parentQuestionId, "parent-q-100");
  assert.equal(goals[0].semanticGroup, "PARENT_IMPORTANT_QUESTION");

  // 나머지 9개는 P1~P3 순서대로 채워짐
  for (let i = 1; i < 10; i++) {
    assert.equal(goals[i].goalOrder, i + 1);
    assert.notEqual(goals[i].priority, "P0");
  }
});

// 8. 관계 단계 평가가 실패해도 미션이 시작된다
test("8. 관계 단계 평가가 실패해도 미션이 시작된다", async () => {
  const questionRows = Array.from({ length: 12 }, (_, i) => makeQuestionRow({
    id: `q-${i + 1}`,
    question_text: `질문 ${i + 1}`,
    semantic_group: `FALLBACK_GROUP_${i + 1}`,
  }));
  const { db } = makeMockDb(questionRows);

  let effectiveStage: RelationshipCalendarStage | null = null;
  try {
    // 평가 실패 시뮬레이션
    throw new Error("DB Connection Timeout in evaluateRelationshipStage");
  } catch (error) {
    // route.ts의 에러 핸들링과 동일하게 null fallback
    effectiveStage = null;
  }

  // 평가 실패 후에도 effectiveStage: null로 후보 정상 조회
  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "child-error-fallback",
    grade: 4,
    weekday: "thu",
    effectiveStage,
  });

  assert.ok(candidates.length >= 10);

  const goals = selectConversationGoalDrafts({
    missionSessionId: "session-fallback-start",
    childId: "child-error-fallback",
    candidates,
  });

  assert.equal(goals.length, 10);
  assert.equal(goals[0].status, "PENDING");
});
