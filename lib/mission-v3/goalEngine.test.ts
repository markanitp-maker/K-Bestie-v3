import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  evaluateGoalSatisfaction,
  initializeConversationGoals,
  selectConversationGoalDrafts,
  type ConversationGoal,
  type GoalAssessment,
} from "./goalEngine.js";
import {
  respondToMissionTurn,
  selectNextPromptGoal,
  type MissionPromptGoal,
} from "./missionAdapter.js";

const makeGoal = (overrides: Partial<ConversationGoal> = {}): ConversationGoal => ({
  goalId: "goal-1",
  missionSessionId: "session-1",
  childId: "child-1",
  goalOrder: 1,
  semanticGroup: "SCHOOL_DAY",
  priority: "P1",
  status: "PENDING",
  evidenceSource: null,
  sourceTurnId: null,
  confidence: null,
  satisfiedAt: null,
  parentQuestionId: null,
  ...overrides,
});

const toGoalRow = (goal: ConversationGoal) => ({
  goal_id: goal.goalId,
  mission_session_id: goal.missionSessionId,
  child_id: goal.childId,
  goal_order: goal.goalOrder,
  semantic_group: goal.semanticGroup,
  priority: goal.priority,
  status: goal.status,
  evidence_source: goal.evidenceSource,
  source_turn_id: goal.sourceTurnId,
  confidence: goal.confidence,
  satisfied_at: goal.satisfiedAt,
  parent_question_id: goal.parentQuestionId,
});

const readGoalMigration = (): string => readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260810190000_mission_v3_conversation_goals.sql"),
  "utf8",
);

test("Goal 생성은 부모 질문 P0을 첫 슬롯에 두고 나머지를 우선순위 순으로 채운다", () => {
  const goals = selectConversationGoalDrafts({
    missionSessionId: "session-1",
    childId: "child-1",
    parentQuestion: {
      id: "parent-question-1",
      semanticGroup: "friend_relation",
      promptInstruction: "오늘 친구와 있었던 일을 자연스럽게 물어봐.",
    },
    candidates: [
      { semanticGroup: "FUN", priority: "P3", promptInstruction: "재미있는 이야기를 이어가." },
      { semanticGroup: "WEEKDAY", priority: "P2", promptInstruction: "요일 분위기를 반영해." },
      { semanticGroup: "PERIODIC", priority: "P1", promptInstruction: "주기 질문을 이어가." },
      { semanticGroup: "FRIEND_RELATION", priority: "P1", promptInstruction: "중복 후보" },
    ],
  });

  assert.equal(goals.length, 4);
  assert.deepEqual(goals.map((goal) => goal.goalOrder), [1, 2, 3, 4]);
  assert.deepEqual(goals.map((goal) => goal.priority), ["P0", "P1", "P2", "P3"]);
  assert.equal(goals[0].parentQuestionId, "parent-question-1");
  assert.equal(goals[0].semanticGroup, "FRIEND_RELATION");
});

test("Goal 후보가 4개 미만이면 불완전 세션을 만들지 않고 실패한다", () => {
  assert.throws(
    () => selectConversationGoalDrafts({
      missionSessionId: "session-1",
      childId: "child-1",
      candidates: [
        { semanticGroup: "ONLY_ONE", priority: "P1", promptInstruction: "한 가지" },
      ],
    }),
    /후보가 부족합니다/,
  );
});

test("한 아이 발화의 source turn 하나가 여러 Goal을 동시에 충족한다", () => {
  const goals = [
    makeGoal(),
    makeGoal({
      goalId: "goal-2",
      goalOrder: 2,
      semanticGroup: "PEER_RELATION",
      priority: "P2",
    }),
    makeGoal({
      goalId: "goal-3",
      goalOrder: 3,
      semanticGroup: "MOOD",
      priority: "P3",
      status: "DECLINED",
    }),
  ];

  const decisions = evaluateGoalSatisfaction({
    goals,
    currentUtterance: "오늘 민서랑 피구해서 이겼고 정말 신났어.",
    sourceTurnId: "turn-7",
    assessedAt: "2026-08-10T10:00:00.000Z",
    assessments: [
      {
        goalId: "goal-1",
        semanticGroup: "school_day",
        status: "SATISFIED",
        confidence: 0.94,
        evidenceSource: "child_utterance",
      },
      {
        goalId: "goal-2",
        semanticGroup: "peer_relation",
        status: "SATISFIED",
        confidence: 0.91,
        evidenceSource: "child_utterance",
      },
      {
        goalId: "goal-3",
        semanticGroup: "mood",
        status: "SATISFIED",
        confidence: 0.99,
        evidenceSource: "child_utterance",
      },
    ],
  });

  assert.equal(decisions.length, 2);
  assert.deepEqual(decisions.map((decision) => decision.goalId), ["goal-1", "goal-2"]);
  assert.ok(decisions.every((decision) => decision.sourceTurnId === "turn-7"));
  assert.ok(decisions.every((decision) => decision.satisfiedAt === "2026-08-10T10:00:00.000Z"));
});

test("증거 발화가 비었거나 confidence가 낮으면 Goal 충족으로 기록하지 않는다", () => {
  const goal = makeGoal();
  const assessment = {
    goalId: goal.goalId,
    semanticGroup: goal.semanticGroup,
    status: "SATISFIED" as const,
    confidence: 0.49,
    evidenceSource: "child_utterance" as const,
  };

  assert.deepEqual(evaluateGoalSatisfaction({
    goals: [goal],
    currentUtterance: "   ",
    sourceTurnId: "turn-1",
    assessedAt: "2026-08-10T10:00:00.000Z",
    assessments: [{ ...assessment, confidence: 0.99 }],
  }), []);
  assert.deepEqual(evaluateGoalSatisfaction({
    goals: [goal],
    currentUtterance: "학교에 갔어.",
    sourceTurnId: "turn-1",
    assessedAt: "2026-08-10T10:00:00.000Z",
    assessments: [assessment],
  }), []);
});

test("R-8/S-2: 허용되지 않은 Goal status는 그 판정만 무시하고 나머지는 정상 반영한다", () => {
  const invalidAssessment = {
    goalId: "goal-1",
    semanticGroup: "SCHOOL_DAY",
    status: "COMPLETE",
    confidence: 0.9,
    evidenceSource: "child_utterance",
  } as unknown as GoalAssessment;
  const validAssessment: GoalAssessment = {
    goalId: "goal-2",
    semanticGroup: "PEER_RELATION",
    status: "SATISFIED",
    confidence: 0.9,
    evidenceSource: "child_utterance",
  };

  const decisions = evaluateGoalSatisfaction({
    goals: [
      makeGoal(),
      makeGoal({ goalId: "goal-2", goalOrder: 2, semanticGroup: "PEER_RELATION", priority: "P2" }),
    ],
    currentUtterance: "오늘 학교에서 재밌었어.",
    sourceTurnId: "turn-1",
    assessedAt: "2026-08-10T10:00:00.000Z",
    assessments: [invalidAssessment, validAssessment],
  });

  assert.deepEqual(decisions.map((decision) => decision.goalId), ["goal-2"]);
});

test("R-5: 부분 초기화의 두 UNIQUE 충돌은 pending 세트를 교체하고 23505 후 완성본을 재조회한다", async () => {
  const existingGoal = makeGoal({ semanticGroup: "STALE_SEMANTIC" });
  const finalGoals = [
    makeGoal(),
    makeGoal({ goalId: "goal-2", goalOrder: 2, semanticGroup: "PEER_RELATION", priority: "P2" }),
    makeGoal({ goalId: "goal-3", goalOrder: 3, semanticGroup: "MOOD", priority: "P3" }),
    makeGoal({ goalId: "goal-4", goalOrder: 4, semanticGroup: "FUN", priority: "P3" }),
  ];
  const operations: string[] = [];
  let sessionFetchCount = 0;

  const db = {
    from: (table: string) => {
      if (table === "conversation_goals") {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({
                data: (sessionFetchCount++ === 0 ? [existingGoal] : finalGoals).map(toGoalRow),
                error: null,
              }),
            }),
          }),
          delete: () => ({
            eq: () => ({
              eq: async () => {
                operations.push("delete-partial");
                return { error: null };
              },
            }),
          }),
          insert: async () => {
            operations.push("insert-drafts");
            return {
              error: {
                code: "23505",
                message: "conversation_goals_session_semantic_key",
              },
            };
          },
        };
      }

      const query = {
        eq: () => query,
        in: () => query,
        order: () => query,
        limit: async () => ({ data: [], error: null }),
      };
      return { select: () => query };
    },
  } as unknown as SupabaseClient;

  const initialized = await initializeConversationGoals({
    db,
    missionSessionId: "session-1",
    childId: "child-1",
    sessionKind: "daily_single",
    candidates: [
      { semanticGroup: "SCHOOL_DAY", priority: "P1", promptInstruction: "학교 이야기" },
      { semanticGroup: "PEER_RELATION", priority: "P2", promptInstruction: "친구 이야기" },
      { semanticGroup: "MOOD", priority: "P3", promptInstruction: "기분 이야기" },
      { semanticGroup: "FUN", priority: "P3", promptInstruction: "재미 이야기" },
    ],
  });

  assert.deepEqual(operations, ["delete-partial", "insert-drafts"]);
  assert.equal(sessionFetchCount, 2);
  assert.deepEqual(initialized.map((goal) => goal.goalId), finalGoals.map((goal) => goal.goalId));
});

test("다음 능동 Goal 선택은 P0을 cooldown보다 우선하고 거절 Goal은 제외한다", async () => {
  const db = {} as unknown as SupabaseClient;
  let cooldownChecks = 0;
  const goals: MissionPromptGoal[] = [
    { ...makeGoal({ status: "DECLINED" }), promptInstruction: "거절된 질문" },
    {
      ...makeGoal({
        goalId: "goal-p0",
        goalOrder: 2,
        semanticGroup: "PARENT_FRIEND",
        priority: "P0",
        parentQuestionId: "parent-1",
      }),
      promptInstruction: "친구 이야기를 자연스럽게 이어가.",
    },
  ];

  const selected = await selectNextPromptGoal(db, "child-1", goals, {
    isTopicOnCooldownForK: async () => {
      cooldownChecks += 1;
      return true;
    },
  });

  assert.equal(selected?.goalId, "goal-p0");
  assert.equal(cooldownChecks, 0);
});

test("Mission Adapter는 Safety preflight가 응답하면 Goal 판정과 respond를 실행하지 않는다", async () => {
  const db = {} as unknown as SupabaseClient;
  const calls: string[] = [];
  const safetyOutput = {
    text: "안전 응답",
    action: "COMFORT" as const,
    category: "safety" as const,
    safetyFlagged: true,
    tokenIn: 0,
    tokenOut: 0,
  };

  const result = await respondToMissionTurn({
    db,
    ai: null as never,
    modelId: "test-model",
    childId: "child-1",
    sessionId: "session-1",
    currentUtterance: "안전 검사가 필요한 발화",
    sourceTurnId: "turn-1",
    goals: [],
    assessments: [],
    engine: {
      checkSafetyPreflight: async () => {
        calls.push("safety");
        return safetyOutput;
      },
      respond: async () => {
        calls.push("respond");
        throw new Error("Safety 뒤에 respond가 호출되면 안 됩니다.");
      },
      isTopicOnCooldownForK: async () => false,
      recordTopicUsage: async () => undefined,
    },
  });

  assert.deepEqual(calls, ["safety"]);
  assert.equal(result.engineOutput, safetyOutput);
  assert.deepEqual(result.goalDecisions, []);
  assert.equal(result.promptedGoalId, null);
});

test("R-3: generated 응답만으로 미전환 Goal cooldown을 기록하지 않는다", async () => {
  const db = {} as unknown as SupabaseClient;
  let cooldownRecords = 0;
  const goal: MissionPromptGoal = {
    ...makeGoal(),
    promptInstruction: "학교 이야기를 자연스럽게 이어가.",
  };

  const result = await respondToMissionTurn({
    db,
    ai: null as never,
    modelId: "test-model",
    childId: "child-1",
    sessionId: "session-1",
    currentUtterance: "그냥 다른 얘기 하고 싶어.",
    sourceTurnId: "turn-1",
    goals: [goal],
    assessments: [],
    engine: {
      checkSafetyPreflight: async () => null,
      respond: async () => ({
        text: "좋아, 무슨 얘기 하고 싶어?",
        action: "FOLLOW_UP",
        category: "generated",
        tokenIn: 1,
        tokenOut: 1,
      }),
      isTopicOnCooldownForK: async () => false,
      recordTopicUsage: async () => {
        cooldownRecords += 1;
      },
    },
  });

  assert.equal(result.promptedGoalId, goal.goalId);
  assert.equal(cooldownRecords, 0);
});

test("C-1: PARTIAL 전이는 cooldown을 기록하지 않고 SATISFIED만 기록한다", async () => {
  const db = {
    from: () => ({
      update: () => ({ eq: () => ({ in: async () => ({ error: null }) }) }),
    }),
  } as unknown as SupabaseClient;
  const recordedInitiators: string[] = [];
  const goal: MissionPromptGoal = {
    ...makeGoal(),
    promptInstruction: "학교 이야기를 자연스럽게 이어가.",
  };

  const result = await respondToMissionTurn({
    db,
    ai: null as never,
    modelId: "test-model",
    childId: "child-1",
    sessionId: "session-1",
    currentUtterance: "음... 그냥 그랬어.",
    sourceTurnId: "turn-1",
    goals: [goal],
    assessments: [{
      goalId: goal.goalId,
      semanticGroup: goal.semanticGroup,
      status: "PARTIAL",
      confidence: 0.7,
      evidenceSource: "child_utterance",
    }],
    engine: {
      checkSafetyPreflight: async () => null,
      respond: async () => ({
        text: "그랬구나, 더 얘기해줄래?",
        action: "FOLLOW_UP",
        category: "generated",
        tokenIn: 1,
        tokenOut: 1,
      }),
      isTopicOnCooldownForK: async () => false,
      recordTopicUsage: async (_db, _childId, _group, _mode, initiatedBy) => {
        recordedInitiators.push(initiatedBy);
      },
    },
  });

  assert.equal(result.goalDecisions[0]?.status, "PARTIAL");
  assert.deepEqual(recordedInitiators, []);
});

test("C-1: promptGoal이 아닌 Goal이 SATISFIED되면 child로 기록한다", async () => {
  const db = {
    from: () => ({
      update: () => ({ eq: () => ({ in: async () => ({ error: null }) }) }),
    }),
  } as unknown as SupabaseClient;
  const recordedInitiators: Array<{ group: string; initiatedBy: string }> = [];
  // goal-1은 P0(항상 우선 선택되는 promptGoal), goal-2는 아이가 먼저 스스로 꺼내
  // 같은 턴에 충족됐지만 K가 이번 턴에 그 방향으로 유도하지는 않았다.
  const promptedGoal: MissionPromptGoal = {
    ...makeGoal({ goalId: "goal-1", priority: "P0", parentQuestionId: "parent-1" }),
    promptInstruction: "부모 질문 방향",
  };
  const spontaneousGoal: MissionPromptGoal = {
    ...makeGoal({ goalId: "goal-2", goalOrder: 2, semanticGroup: "PEER_RELATION", priority: "P2" }),
    promptInstruction: "친구 이야기",
  };

  await respondToMissionTurn({
    db,
    ai: null as never,
    modelId: "test-model",
    childId: "child-1",
    sessionId: "session-1",
    currentUtterance: "참, 민서랑 오늘 진짜 재밌었어!",
    sourceTurnId: "turn-1",
    // K가 직전 턴에 goal-1(P0, 부모 질문) 방향으로 물었고, 아이가 그 답과 함께
    // 스스로 goal-2(친구 관계)도 같이 꺼낸 상황을 재현한다.
    previousPromptedGoalId: "goal-1",
    goals: [promptedGoal, spontaneousGoal],
    assessments: [
      {
        goalId: "goal-1",
        semanticGroup: promptedGoal.semanticGroup,
        status: "SATISFIED",
        confidence: 0.95,
        evidenceSource: "child_utterance",
      },
      {
        goalId: "goal-2",
        semanticGroup: "PEER_RELATION",
        status: "SATISFIED",
        confidence: 0.95,
        evidenceSource: "child_utterance",
      },
    ],
    engine: {
      checkSafetyPreflight: async () => null,
      respond: async () => ({
        text: "우와 정말 재밌었겠다!",
        action: "CELEBRATION",
        category: "generated",
        tokenIn: 1,
        tokenOut: 1,
      }),
      isTopicOnCooldownForK: async () => false,
      recordTopicUsage: async (_db, _childId, group, _mode, initiatedBy) => {
        recordedInitiators.push({ group, initiatedBy });
      },
    },
  });

  const byGroup = new Map(recordedInitiators.map((entry) => [entry.group, entry.initiatedBy]));
  assert.equal(byGroup.get(promptedGoal.semanticGroup), "parent_question");
  assert.equal(byGroup.get("PEER_RELATION"), "child");
});

test("S-1: 일부 Goal 저장 실패해도 성공한 판정은 유지된다", async () => {
  const db = {
    from: () => ({
      update: () => ({
        eq: (_column: string, goalId: string) => ({
          in: async () => (goalId === "goal-1"
            ? { error: { message: "forced failure for goal-1" } }
            : { error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  const goals: MissionPromptGoal[] = [
    { ...makeGoal(), promptInstruction: "학교 이야기" },
    { ...makeGoal({ goalId: "goal-2", goalOrder: 2, semanticGroup: "PEER_RELATION", priority: "P2" }), promptInstruction: "친구 이야기" },
  ];

  const result = await respondToMissionTurn({
    db,
    ai: null as never,
    modelId: "test-model",
    childId: "child-1",
    sessionId: "session-1",
    currentUtterance: "오늘 학교도 재밌었고 민서랑도 놀았어.",
    sourceTurnId: "turn-1",
    goals,
    assessments: [
      { goalId: "goal-1", semanticGroup: "SCHOOL_DAY", status: "SATISFIED", confidence: 0.9, evidenceSource: "child_utterance" },
      { goalId: "goal-2", semanticGroup: "PEER_RELATION", status: "SATISFIED", confidence: 0.9, evidenceSource: "child_utterance" },
    ],
    engine: {
      checkSafetyPreflight: async () => null,
      respond: async () => ({ text: "좋았겠다!", action: "CELEBRATION", category: "generated", tokenIn: 1, tokenOut: 1 }),
      isTopicOnCooldownForK: async () => false,
      recordTopicUsage: async () => undefined,
    },
  });

  assert.deepEqual(result.goalDecisions.map((decision) => decision.goalId), ["goal-2"]);
});

test("R-4: Goal 저장 실패에도 respond를 호출하고 빈 decision으로 fail-open한다", async () => {
  let respondCalls = 0;
  const db = {
    from: () => ({
      update: () => ({
        eq: () => ({
          in: async () => ({ error: { message: "forced update failure" } }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  const goal: MissionPromptGoal = {
    ...makeGoal(),
    promptInstruction: "학교 이야기를 자연스럽게 이어가.",
  };

  const result = await respondToMissionTurn({
    db,
    ai: null as never,
    modelId: "test-model",
    childId: "child-1",
    sessionId: "session-1",
    currentUtterance: "오늘 체육이 재밌었어.",
    sourceTurnId: "turn-1",
    goals: [goal],
    assessments: [{
      goalId: goal.goalId,
      semanticGroup: goal.semanticGroup,
      status: "SATISFIED",
      confidence: 0.9,
      evidenceSource: "child_utterance",
    }],
    engine: {
      checkSafetyPreflight: async () => null,
      respond: async () => {
        respondCalls += 1;
        return {
          text: "체육 시간에 뭐 했어?",
          action: "CURIOSITY",
          category: "generated",
          tokenIn: 1,
          tokenOut: 1,
        };
      },
      isTopicOnCooldownForK: async () => false,
      recordTopicUsage: async () => undefined,
    },
  });

  assert.equal(respondCalls, 1);
  assert.deepEqual(result.goalDecisions, []);
  assert.equal(result.engineOutput.text, "체육 시간에 뭐 했어?");
});

test("migration SQL은 additive FK/RLS/GRANT 계약과 기본 문법 균형을 만족한다", () => {
  const sql = readGoalMigration();

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.conversation_goals/i);
  for (const column of [
    "goal_id",
    "mission_session_id",
    "child_id",
    "semantic_group",
    "priority",
    "status",
    "evidence_source",
    "source_turn_id",
    "confidence",
    "satisfied_at",
    "parent_question_id",
  ]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`, "i"));
  }
  assert.match(sql, /REFERENCES public\.chat_sessions\(id\)/i);
  assert.match(sql, /REFERENCES public\.parent_questions\(id\)/i);
  assert.match(sql, /ALTER TABLE public\.conversation_goals ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /GRANT ALL ON public\.conversation_goals TO anon, authenticated/i);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE FROM|ALTER TABLE)\s+(?:public\.)?(?:mission_progress|chat_sessions|parent_questions)\b/i);

  const withoutCommentsAndStrings = sql
    .replace(/--.*$/gm, "")
    .replace(/'(?:''|[^'])*'/g, "''");
  const openParentheses = [...withoutCommentsAndStrings].filter((character) => character === "(").length;
  const closeParentheses = [...withoutCommentsAndStrings].filter((character) => character === ")").length;
  assert.equal(openParentheses, closeParentheses);
  assert.ok(sql.trimEnd().endsWith(";"));
});

test("R-1: migration은 family SELECT 정책을 제거하고 RLS-bound role을 deny-all 처리한다", () => {
  const sql = readGoalMigration();

  assert.match(sql, /DROP POLICY IF EXISTS conversation_goals_family_select\s+ON public\.conversation_goals/i);
  assert.doesNotMatch(sql, /CREATE POLICY conversation_goals_family_select/i);
  assert.match(
    sql,
    /CREATE POLICY conversation_goals_service_all[\s\S]*?FOR ALL[\s\S]*?USING \(false\)[\s\S]*?WITH CHECK \(false\)/i,
  );
  assert.match(sql, /GRANT ALL ON public\.conversation_goals TO anon, authenticated/i);
});

test("R-2: SATISFIED CHECK는 nullable source turn 삭제를 허용하고 운영 삭제 RPC SQL 검증을 갖는다", () => {
  const sql = readGoalMigration();
  const constraintStart = sql.indexOf("CONSTRAINT conversation_goals_satisfied_evidence_check");
  const constraintEnd = sql.indexOf("CONSTRAINT conversation_goals_satisfied_at_check");
  const satisfiedConstraint = sql.slice(constraintStart, constraintEnd);
  const verificationSql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/tests/mission_v3_conversation_goals_verification.sql"),
    "utf8",
  );

  assert.ok(constraintStart >= 0 && constraintEnd > constraintStart);
  assert.doesNotMatch(satisfiedConstraint, /source_turn_id\s+IS\s+NOT\s+NULL/i);
  assert.match(satisfiedConstraint, /evidence_source\s+IS\s+NOT\s+NULL/i);
  assert.match(satisfiedConstraint, /confidence\s+IS\s+NOT\s+NULL/i);
  assert.match(satisfiedConstraint, /satisfied_at\s+IS\s+NOT\s+NULL/i);
  assert.match(verificationSql, /cleanup_chat_messages_v3/i);
  assert.match(verificationSql, /delete_child_profile/i);
  assert.match(verificationSql, /source_turn_id IS NULL/i);
  assert.match(verificationSql, /ROLLBACK;/i);
});

test("R-7: migration의 table/index/policy DDL은 재실행 가능한 멱등 패턴이다", () => {
  const sql = readGoalMigration();

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.conversation_goals/i);
  assert.equal((sql.match(/CREATE INDEX IF NOT EXISTS/gi) ?? []).length, 2);
  assert.match(sql, /DROP POLICY IF EXISTS conversation_goals_family_select/i);
  assert.match(sql, /DROP POLICY IF EXISTS conversation_goals_service_all/i);
});

test("Mission Adapter는 071 공용 진입점만 사용하고 금지된 내부 모듈을 import하지 않는다", () => {
  const adapterSource = readFileSync(
    resolve(process.cwd(), "lib/mission-v3/missionAdapter.ts"),
    "utf8",
  );
  assert.match(adapterSource, /checkSafetyPreflight/);
  assert.match(adapterSource, /\brespond\b/);
  assert.match(adapterSource, /semanticTopicHistory/);
  assert.doesNotMatch(adapterSource, /k-conversation\/(?:actionSelector|boredomDetection|corePersona|memory|responseGenerator)/);
});
