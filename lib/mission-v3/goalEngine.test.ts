import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  evaluateGoalSatisfaction,
  selectConversationGoalDrafts,
  type ConversationGoal,
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

test("migration SQL은 additive FK/RLS/GRANT 계약과 기본 문법 균형을 만족한다", () => {
  const migrationPath = resolve(
    process.cwd(),
    "supabase/migrations/20260810190000_mission_v3_conversation_goals.sql",
  );
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /CREATE TABLE public\.conversation_goals/i);
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
