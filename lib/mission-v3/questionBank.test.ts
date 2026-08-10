import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchRecentTopics,
  isTopicOnCooldownForK,
  recordTopicUsage,
} from "@/lib/k-conversation/semanticTopicHistory";
import {
  estimateSemanticGroup,
  extractUtteranceSignals,
} from "@/lib/k-conversation/utteranceSignals";
import {
  filterQuestionCandidatesByCooldown,
  loadMissionQuestionGoalCandidates,
  recordMissionQuestionTopicUsage,
  toGoalCandidate,
  type MissionQuestionGoalCandidate,
  type MissionQuestionMetadataRow,
} from "./questionBank.js";

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
  id: "question-school",
  question_text: "오늘 학교에서 제일 기억에 남는 일은 뭐야?",
  applicable_grades: [4],
  semantic_group: "SCHOOL_EXPERIENCE",
  cooldown_days: 3,
  weekday_affinity: ["mon"],
  topic: "school_experience",
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

const makeDb = (questionRows: Array<Record<string, unknown>> = []) => {
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
          if (!Array.isArray(rowValues) || !values.every((value) => rowValues.includes(value))) return false;
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
        last_used_at: new Date().toISOString(),
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

const metadataQuestion: MissionQuestionMetadataRow = {
  id: "question-1",
  questionText: "이번 주에 친구와 제일 즐거웠던 일은 뭐야?",
  applicableGrades: [4],
  semanticGroup: "peer_connection",
  cooldownDays: 7,
  weekdayAffinity: ["tue"],
  topic: "peer_connection",
  conversationStyle: "reflective",
  funType: "reflection",
  memoryUsable: true,
  sensitivity: "low",
  answerMode: "open",
  periodicity: "weekly",
};

test("질문 metadata는 Phase 1 GoalCandidate 계약의 semanticGroup/priority/promptInstruction로 변환된다", () => {
  const periodic = toGoalCandidate(metadataQuestion, "tue");
  assert.equal(periodic.semanticGroup, "PEER_CONNECTION");
  assert.equal(periodic.priority, "P1");
  assert.match(periodic.promptInstruction, /peer_connection/);
  assert.match(periodic.promptInstruction, /이번 주에 친구와 제일 즐거웠던 일/);

  const weekday = toGoalCandidate({ ...metadataQuestion, periodicity: "flexible" }, "tue");
  const fallback = toGoalCandidate({ ...metadataQuestion, periodicity: "flexible" }, "fri");
  assert.equal(weekday.priority, "P2");
  assert.equal(fallback.priority, "P3");
});

test("FREE_CHAT에서 K가 먼저 쓴 semantic group은 같은 공용 테이블을 보는 MISSION 질문 후보에서 제외된다", async () => {
  const { db } = makeDb([
    makeQuestionRow(),
    makeQuestionRow({
      id: "question-mood",
      question_text: "오늘 기분을 색깔로 말하면 무슨 색이야?",
      semantic_group: "MOOD_CHECK",
      topic: "mood_check",
      weekday_affinity: [],
      answer_mode: "metaphor",
    }),
  ]);
  const freeChatSemanticGroup = estimateSemanticGroup(extractUtteranceSignals("오늘 정말 좋았어."));
  assert.equal(freeChatSemanticGroup, "MOOD_CHECK");
  await recordTopicUsage(db, "child-1", freeChatSemanticGroup, "free_chat", "k", 3);

  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "child-1",
    grade: 4,
    weekday: "mon",
  });

  assert.deepEqual(candidates.map((candidate) => candidate.semanticGroup), ["SCHOOL_EXPERIENCE"]);
});

test("아이가 먼저 꺼낸 질문은행 주제는 cooldown 중이어도 제한하지 않는다", async () => {
  const { db } = makeDb();
  const candidate = toGoalCandidate(metadataQuestion, "tue");
  await recordTopicUsage(db, "child-1", candidate.semanticGroup, "free_chat", "k", 7);

  const filtered = await filterQuestionCandidatesByCooldown({
    db,
    childId: "child-1",
    candidates: [candidate],
    initiatedBy: "child",
  });

  assert.deepEqual(filtered, [candidate]);
});

test("MISSION/FREE_CHAT 기록은 child+semantic_group 한 행을 공유하고 child가 최신 initiator면 K cooldown이 해제된다", async () => {
  const { db } = makeDb();
  await recordTopicUsage(db, "child-1", "DIGITAL_CONTENT", "free_chat", "k", 3);
  assert.equal(await isTopicOnCooldownForK(db, "child-1", "DIGITAL_CONTENT"), true);

  await recordTopicUsage(db, "child-1", "DIGITAL_CONTENT", "mission", "child", 3);
  assert.equal(await isTopicOnCooldownForK(db, "child-1", "DIGITAL_CONTENT"), false);
  const recent = await fetchRecentTopics(db, "child-1");
  assert.equal(recent.length, 1);
  assert.equal(recent[0].mode, "mission");
  assert.equal(recent[0].lastInitiatedBy, "child");
  assert.equal(recent[0].childFrequency, 1);
  assert.equal(recent[0].kFrequency, 1);
});

test("질문은행 prompt 기록은 metadata cooldown과 mission mode를 공용 RPC에 전달한다", async () => {
  const { db, topics, topicKey } = makeDb();
  const candidate = toGoalCandidate(metadataQuestion, "tue");
  await recordMissionQuestionTopicUsage({
    db,
    childId: "child-1",
    candidate,
    initiatedBy: "k",
  });

  const topic = topics.get(topicKey("child-1", "PEER_CONNECTION"));
  assert.equal(topic?.mode, "mission");
  assert.equal(topic?.last_initiated_by, "k");
  assert.equal(topic?.k_frequency, 1);
  assert.ok(new Date(topic?.cooldown_until ?? 0).getTime() > Date.now() + 6 * 86_400_000);
});

test("metadata migration은 10개 컬럼을 모두 채우고 기존 질문을 삭제하거나 구조 파괴하지 않는다", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260810200000_mission_question_metadata.sql"),
    "utf8",
  );
  const columns = [
    "semantic_group",
    "cooldown_days",
    "weekday_affinity",
    "topic",
    "conversation_style",
    "fun_type",
    "memory_usable",
    "sensitivity",
    "answer_mode",
    "periodicity",
  ];
  columns.forEach((column) => {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
    assert.match(sql, new RegExp(`${column} SET NOT NULL`));
  });
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+(?:public\.)?mission_questions/i);
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN)/i);
  assert.match(sql, /classification incomplete/);
});

test("질문 metadata의 핵심 의미 키는 071 FREE_CHAT estimator namespace와 일치한다", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260810200000_mission_question_metadata.sql"),
    "utf8",
  );
  const cases = [
    ["100점 맞았어!", "ACHIEVEMENT"],
    ["오늘 친구랑 싸웠어.", "FRIEND_CONFLICT"],
    ["지금 너무 졸려.", "PHYSICAL_STATE"],
    ["만약 투명인간이 된다면 좋겠어.", "PLAYFUL_IMAGINATION"],
    ["오늘 정말 좋았어.", "MOOD_CHECK"],
  ] as const;

  cases.forEach(([utterance, expected]) => {
    assert.equal(estimateSemanticGroup(extractUtteranceSignals(utterance)), expected);
    assert.match(sql, new RegExp(`THEN '${expected}'`));
  });
});
