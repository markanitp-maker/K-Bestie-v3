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
  toMetadataRow,
  type MissionQuestionGoalCandidate,
  type MissionQuestionMetadataRow,
} from "./questionBank.js";
import { loadMissionPromptGoals } from "./routeSupport";
import {
  selectConversationGoalDrafts,
  type ConversationGoal,
  type GoalCandidate,
} from "./goalEngine";

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

interface ProgressState {
  session_id: string;
  child_id: string;
  question_ids: string[];
  created_at: string;
  business_date?: string;
  status?: string;
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
  school_context_tag: "universal",
  is_active: true,
  clinical_status: "APPROVED",
  created_at: "2026-08-03T00:00:00.000Z",
  ...overrides,
});

const makeDb = (
  questionRows: Array<Record<string, unknown>> = [],
  progressRows: ProgressState[] = [],
  temporalRows: Array<Record<string, unknown>> = [],
  options?: { errorOnTemporal?: boolean; errorOnSchoolContextTag?: boolean },
) => {
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

    if (table === "mission_progress") {
      let rows = progressRows.filter((row) => {
        for (const [column, value] of state.equals) {
          if ((row as Record<string, unknown>)[column] !== value) return false;
        }
        return true;
      });
      rows.sort((left, right) => right.created_at.localeCompare(left.created_at));
      if (state.limit !== null) rows = rows.slice(0, state.limit);
      return rows;
    }

    if (table === "child_temporal_context") {
      let rows = temporalRows.filter((row) => {
        for (const [column, value] of state.equals) {
          if ((row as Record<string, unknown>)[column] !== value) return false;
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
    let selectedColumns = "";

    const query = {
      select: (columns = "*") => {
        selectedColumns = columns;
        return query;
      },
      eq: (column: string, value: unknown) => {
        state.equals.set(column, value);
        return query;
      },
      is: (column: string, value: unknown) => {
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
      maybeSingle: async () => {
        if (table === "child_temporal_context" && options?.errorOnTemporal) {
          return { data: null, error: { message: "child_temporal_context lookup error" } };
        }
        return { data: resolveRows(table, state)[0] ?? null, error: null };
      },
      then: (
        onFulfilled: (value: { data: unknown[]; error: any }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => {
        if (table === "mission_questions" && options?.errorOnSchoolContextTag && selectedColumns.includes("school_context_tag")) {
          return Promise.resolve({ data: null, error: { message: "column school_context_tag does not exist" } }).then(onFulfilled, onRejected);
        }
        return Promise.resolve({ data: resolveRows(table, state), error: null }).then(onFulfilled, onRejected);
      },
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
  const weekdayMatch = toGoalCandidate(metadataQuestion, "tue");
  assert.equal(weekdayMatch.semanticGroup, "PEER_CONNECTION");
  assert.equal(weekdayMatch.priority, "P1");
  assert.match(weekdayMatch.promptInstruction, /peer_connection/);
  assert.match(weekdayMatch.promptInstruction, /이번 주에 친구와 제일 즐거웠던 일/);

  const periodicOnly = toGoalCandidate({ ...metadataQuestion, weekdayAffinity: [] }, "fri");
  assert.equal(periodicOnly.priority, "P2");

  const fallback = toGoalCandidate({ ...metadataQuestion, periodicity: "flexible", weekdayAffinity: [], memoryUsable: false }, "fri");
  assert.equal(fallback.priority, "P3");
});

test("filterQuestionCandidatesByCooldown은 K가 먼저 쓴 semantic group을 제외한다", async () => {
  const { db } = makeDb();
  const freeChatSemanticGroup = estimateSemanticGroup(extractUtteranceSignals("오늘 정말 좋았어."));
  assert.equal(freeChatSemanticGroup, "MOOD_CHECK");
  await recordTopicUsage(db, "child-1", freeChatSemanticGroup, "free_chat", "k", 3);

  const candidate1 = toGoalCandidate(toMetadataRow(makeQuestionRow()), "mon");
  const candidate2 = toGoalCandidate(
    toMetadataRow(makeQuestionRow({
      id: "question-mood",
      question_text: "오늘 기분을 색깔로 말하면 무슨 색이야?",
      semantic_group: "MOOD_CHECK",
      topic: "mood_check",
      weekday_affinity: [],
      answer_mode: "metaphor",
    })),
    "mon",
  );

  const filtered = await filterQuestionCandidatesByCooldown({
    db,
    childId: "child-1",
    candidates: [candidate1, candidate2],
    initiatedBy: "k",
  });

  assert.deepEqual(filtered.map((candidate) => candidate.semanticGroup), ["SCHOOL_EXPERIENCE"]);
});

test("loadMissionQuestionGoalCandidates는 non-cooldown을 먼저 두고 cooldown 후보를 뒤에 배치한다", async () => {
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
  await recordTopicUsage(db, "child-1", "MOOD_CHECK", "free_chat", "k", 3);

  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "child-1",
    grade: 4,
    weekday: "mon",
  });

  assert.equal(candidates[0].semanticGroup, "SCHOOL_EXPERIENCE");
  assert.equal(candidates[1].semanticGroup, "MOOD_CHECK");
  assert.equal(candidates[1].priority, "P3");
});

test("applyCooldown=false면 cooldown 중인 주제도 후보에 남는다(확정 Goal instruction 복원용)", async () => {
  // 2026-08-16 안서현 Production 장애: 이미 conversation_goals에 저장된 Goal의
  // semantic_group이 cooldown에 걸리면 instruction을 못 찾아 /turn이 500으로 죽었다.
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
  await recordTopicUsage(db, "child-1", "MOOD_CHECK", "free_chat", "k", 3);

  const filtered = await loadMissionQuestionGoalCandidates({
    db, childId: "child-1", grade: 4, weekday: "mon",
  });
  assert.equal(filtered[0].semanticGroup, "SCHOOL_EXPERIENCE");
  assert.equal(filtered[1].semanticGroup, "MOOD_CHECK");

  const restored = await loadMissionQuestionGoalCandidates({
    db, childId: "child-1", grade: 4, weekday: "mon", applyCooldown: false,
  });
  const groups = restored.map((candidate) => candidate.semanticGroup);
  assert.ok(groups.includes("MOOD_CHECK"), "cooldown 중인 주제도 복원 경로에서는 남아야 한다");
  assert.ok(groups.includes("SCHOOL_EXPERIENCE"));
  for (const candidate of restored) {
    assert.ok(candidate.promptInstruction.trim().length > 0, "instruction이 비면 복원이 실패한다");
  }
});

const openGoal = (goalOrder: number, semanticGroup: string): ConversationGoal => ({
  goalId: `goal-${goalOrder}`,
  missionSessionId: "7dbd3513-c89e-4fbc-acc5-6628d8e6e3cb",
  childId: "child-1",
  goalOrder,
  semanticGroup,
  priority: "P3",
  status: "PENDING",
  evidenceSource: null,
  sourceTurnId: null,
  confidence: null,
  satisfiedAt: null,
  parentQuestionId: null,
});

test("확정 저장된 Goal은 semantic_group이 cooldown 중이어도 instruction이 복원된다", async () => {
  // 2026-08-16 안서현 Production 재현: 열린 Goal 3개(ACHIEVEMENT/INTEREST_AND_PREFERENCE/
  // PHYSICAL_STATE) 중 다음 차례인 ACHIEVEMENT가 cooldown 상태였다.
  // 수정 전에는 여기서 "Conversation Goal 대화 지시를 복원할 수 없습니다"로 throw했고
  // /turn이 500 "미션 대화 목표를 불러오지 못했어요."로 죽었다.
  const groups = ["ACHIEVEMENT", "INTEREST_AND_PREFERENCE", "PHYSICAL_STATE"];
  const { db } = makeDb(groups.map((semanticGroup, index) => makeQuestionRow({
    id: `question-${semanticGroup.toLowerCase()}`,
    question_text: `${semanticGroup} 질문 ${index}`,
    semantic_group: semanticGroup,
    topic: semanticGroup.toLowerCase(),
    weekday_affinity: [],
  })));
  await recordTopicUsage(db, "child-1", "ACHIEVEMENT", "mission", "k", 7);

  const openGoals = [openGoal(8, "ACHIEVEMENT"), openGoal(9, "INTEREST_AND_PREFERENCE"), openGoal(10, "PHYSICAL_STATE")];
  const restored = await loadMissionPromptGoals({
    db, childId: "child-1", grade: 4, goals: openGoals,
  });

  assert.equal(restored.length, 3);
  const byGroup = new Map(restored.map((goal) => [goal.semanticGroup, goal.promptInstruction]));
  for (const semanticGroup of groups) {
    const instruction = byGroup.get(semanticGroup);
    assert.ok(instruction && instruction.trim().length > 0, `${semanticGroup} instruction 복원 실패`);
  }
  // Goal 8이 이번 장애의 실제 차단 지점이다.
  assert.ok(byGroup.get("ACHIEVEMENT"));
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

test("078-B-1: 최근 7일에 쓴 question_id 가 후보에서 제외된다", async () => {
  const questionRows = Array.from({ length: 15 }, (_, i) => makeQuestionRow({
    id: `q-${i + 1}`,
    question_text: `질문 ${i + 1}`,
    semantic_group: `GROUP_${i + 1}`,
    question_family: `FAMILY_${i + 1}`,
  }));
  const progressRows = [
    {
      session_id: "prev-session-1",
      child_id: "child-test-1",
      question_ids: ["q-1", "q-2"],
      created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    },
  ];
  const { db } = makeDb(questionRows, progressRows);

  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "child-test-1",
    grade: 4,
    weekday: "mon",
  });

  const goals = selectConversationGoalDrafts({
    missionSessionId: "sess-1",
    childId: "child-test-1",
    candidates,
  });

  assert.equal(goals.length, 10);
  const selectedQuestionIds = candidates.slice(0, 10).map((c) => c.questionId);
  assert.ok(!selectedQuestionIds.includes("q-1"), "최근 7일에 쓴 q-1은 제외되어야 함");
  assert.ok(!selectedQuestionIds.includes("q-2"), "최근 7일에 쓴 q-2는 제외되어야 함");
});

test("078-B-2: 같은 family 가 감점된다 (제외가 아니라 감점)", async () => {
  const questionRows = [
    makeQuestionRow({
      id: "q-fam-recent",
      question_text: "최근 사용된 패밀리의 새 질문",
      semantic_group: "GAME_TODAY_GROUP",
      question_family: "GAME_TODAY",
      weekday_affinity: ["wed"],
    }),
    makeQuestionRow({
      id: "q-fam-fresh",
      question_text: "미사용 패밀리의 질문",
      semantic_group: "FRIEND_PLAY_GROUP",
      question_family: "FRIEND_PLAY",
      weekday_affinity: ["wed"],
    }),
  ];
  const oldQuestionRow = makeQuestionRow({
    id: "q-old-game",
    question_text: "옛날 게임 질문",
    semantic_group: "OLD_GAME_GROUP",
    question_family: "GAME_TODAY",
  });
  const progressRows = [
    {
      session_id: "prev-session-fam",
      child_id: "child-test-fam",
      question_ids: ["q-old-game"],
      created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    },
  ];
  const { db } = makeDb([...questionRows, oldQuestionRow], progressRows);

  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "child-test-fam",
    grade: 4,
    weekday: "wed",
  });

  assert.equal(candidates[0].questionId, "q-fam-fresh");
  const recentFamCandidate = candidates.find((c) => c.questionId === "q-fam-recent");
  assert.ok(recentFamCandidate, "같은 family는 제외가 아니라 감점이어야 하므로 후보에 존재해야 함");
});

test("078-B-3: question_family 가 null 이거나 컬럼이 없어도 터지지 않는다", async () => {
  const questionRows = Array.from({ length: 12 }, (_, i) => {
    const row = makeQuestionRow({
      id: `q-nofam-${i + 1}`,
      question_text: `질문 ${i + 1}`,
      semantic_group: `NOFAM_GROUP_${i + 1}`,
    });
    delete (row as Record<string, unknown>).question_family;
    return row;
  });
  const { db } = makeDb(questionRows);

  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "child-nofam",
    grade: 4,
    weekday: "mon",
  });

  assert.ok(candidates.length >= 10);
  const goals = selectConversationGoalDrafts({
    missionSessionId: "sess-nofam",
    childId: "child-nofam",
    candidates,
  });
  assert.equal(goals.length, 10);
});

test("078-B-4: 첫 질문 family 가 7일 내 반복되지 않는다", async () => {
  const questionRows = [
    makeQuestionRow({
      id: "q-school-today",
      question_text: "오늘 학교 어땠어?",
      semantic_group: "SCHOOL_TODAY",
      question_family: "SCHOOL_HIGHLIGHT",
      weekday_affinity: ["mon"],
    }),
    makeQuestionRow({
      id: "q-academy-today",
      question_text: "오늘 학원 뭐 배웠어?",
      semantic_group: "ACADEMY_TODAY",
      question_family: "ACADEMY_TODAY",
      weekday_affinity: ["mon"],
    }),
  ];
  const oldFirstQ = makeQuestionRow({
    id: "q-school-yesterday",
    question_text: "어제 학교 어땠어?",
    semantic_group: "SCHOOL_YESTERDAY",
    question_family: "SCHOOL_HIGHLIGHT",
  });
  const progressRows = [
    {
      session_id: "prev-session-first",
      child_id: "child-first-q",
      question_ids: ["q-school-yesterday"],
      created_at: new Date(Date.now() - 1 * 86_400_000).toISOString(),
    },
  ];
  const { db } = makeDb([...questionRows, oldFirstQ], progressRows);

  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "child-first-q",
    grade: 4,
    weekday: "mon",
  });

  assert.equal(candidates[0].questionFamily, "ACADEMY_TODAY");
  assert.equal(candidates[0].questionId, "q-academy-today");
});

test("078-B-5: 후보가 극단적으로 부족해도 정확히 10개를 반환한다", async () => {
  const questionRows = Array.from({ length: 12 }, (_, i) => makeQuestionRow({
    id: `q-scarce-${i + 1}`,
    question_text: `질문 ${i + 1}`,
    semantic_group: `SCARCE_GROUP_${i + 1}`,
    question_family: `FAMILY_${i + 1}`,
  }));
  const usedIds = questionRows.slice(0, 10).map((q) => q.id);
  const progressRows = [
    {
      session_id: "prev-session-scarce",
      child_id: "child-scarce",
      question_ids: usedIds,
      created_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    },
  ];
  const { db } = makeDb(questionRows, progressRows);

  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "child-scarce",
    grade: 4,
    weekday: "mon",
  });

  const goals = selectConversationGoalDrafts({
    missionSessionId: "sess-scarce",
    childId: "child-scarce",
    candidates,
  });

  assert.equal(goals.length, 10);
  const uniqueGroups = new Set(goals.map((g) => g.semanticGroup));
  assert.equal(uniqueGroups.size, 10);
});

test("078-B-6: 후보가 0에 가까워도 10개를 반환한다", async () => {
  const questionRows = [
    makeQuestionRow({
      id: "q-zero-1",
      question_text: "유일한 질문 1",
      semantic_group: "ONLY_GROUP_1",
    }),
    makeQuestionRow({
      id: "q-zero-2",
      question_text: "유일한 질문 2",
      semantic_group: "ONLY_GROUP_2",
    }),
  ];
  const { db } = makeDb(questionRows, []);

  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "child-zero",
    grade: 4,
    weekday: "mon",
  });

  const goals = selectConversationGoalDrafts({
    missionSessionId: "sess-zero",
    childId: "child-zero",
    candidates,
  });

  assert.equal(goals.length, 10);
  const uniqueGroups = new Set(goals.map((g) => g.semanticGroup));
  assert.equal(uniqueGroups.size, 10);
});

test("078-B-7: P0 부모 질문이 있으면 1번 슬롯을 지킨다", () => {
  const candidates: GoalCandidate[] = Array.from({ length: 15 }, (_, i) => ({
    questionId: `q-cand-${i + 1}`,
    semanticGroup: `CAND_GROUP_${i + 1}`,
    priority: i < 3 ? "P1" : i < 6 ? "P2" : "P3",
    promptInstruction: `지시 ${i + 1}`,
  }));

  const goals = selectConversationGoalDrafts({
    missionSessionId: "sess-p0",
    childId: "child-p0",
    parentQuestion: {
      id: "parent-q-uuid-1",
      semanticGroup: "PARENT_IMPORTANT_QUESTION",
      promptInstruction: "부모님 질문을 물어봐.",
    },
    candidates,
  });

  assert.equal(goals.length, 10);
  assert.equal(goals[0].goalOrder, 1);
  assert.equal(goals[0].priority, "P0");
  assert.equal(goals[0].parentQuestionId, "parent-q-uuid-1");
  assert.equal(goals[0].questionId, "parent-q-uuid-1");
});

test("078-B-8: 이력이 전혀 없는 신규 아이도 정상 동작한다", async () => {
  const questionRows = Array.from({ length: 15 }, (_, i) => makeQuestionRow({
    id: `q-new-${i + 1}`,
    question_text: `신규 질문 ${i + 1}`,
    semantic_group: `NEW_GROUP_${i + 1}`,
  }));
  const { db } = makeDb(questionRows, []);

  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "brand-new-child",
    grade: 4,
    weekday: "mon",
  });

  assert.ok(candidates.length >= 10);
  const goals = selectConversationGoalDrafts({
    missionSessionId: "sess-new",
    childId: "brand-new-child",
    candidates,
  });
  assert.equal(goals.length, 10);
  assert.equal(goals[0].goalOrder, 1);
});

test("078-C-1: 방학 상태에서 school_required 질문이 후보에 0건이다", async () => {
  const questionRows = [
    ...Array.from({ length: 10 }, (_, i) => makeQuestionRow({
      id: `q-univ-${i + 1}`,
      question_text: `일반 질문 ${i + 1}`,
      semantic_group: `UNIV_GROUP_${i + 1}`,
      school_context_tag: "universal",
    })),
    ...Array.from({ length: 5 }, (_, i) => makeQuestionRow({
      id: `q-school-${i + 1}`,
      question_text: `학교 질문 ${i + 1}`,
      semantic_group: `SCHOOL_GROUP_${i + 1}`,
      school_context_tag: "school_required",
    })),
  ];
  const temporalRows = [
    {
      id: "ctx-1",
      child_id: "child-vacation-1",
      context_type: "vacation_school",
      status: "VACATION_CONFIRMED",
      expected_school_start_date: "2026-09-01",
      school_question_block_until: "2026-08-31",
      confirmation_status: null,
      last_asked_business_date: null,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
      expired_at: null,
    },
  ];
  const { db } = makeDb(questionRows, [], temporalRows);

  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "child-vacation-1",
    grade: 4,
    weekday: "mon",
    now: new Date("2026-08-17T10:00:00.000Z"),
  });

  const schoolCandidates = candidates.filter((c) => c.schoolContextTag === "school_required");
  assert.equal(schoolCandidates.length, 0, "방학 중에는 school_required 질문이 0건이어야 함");
  assert.ok(candidates.length >= 10);
});

test("078-C-2: 학기 상태에서 학교 질문이 정상 노출된다", async () => {
  const questionRows = [
    ...Array.from({ length: 10 }, (_, i) => makeQuestionRow({
      id: `q-univ-${i + 1}`,
      question_text: `일반 질문 ${i + 1}`,
      semantic_group: `UNIV_GROUP_${i + 1}`,
      school_context_tag: "universal",
    })),
    ...Array.from({ length: 5 }, (_, i) => makeQuestionRow({
      id: `q-school-${i + 1}`,
      question_text: `학교 질문 ${i + 1}`,
      semantic_group: `SCHOOL_GROUP_${i + 1}`,
      school_context_tag: "school_required",
    })),
  ];
  const temporalRows = [
    {
      id: "ctx-2",
      child_id: "child-semester-1",
      context_type: "vacation_school",
      status: "SEMESTER",
      expected_school_start_date: null,
      school_question_block_until: null,
      confirmation_status: null,
      last_asked_business_date: null,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
      expired_at: null,
    },
  ];
  const { db } = makeDb(questionRows, [], temporalRows);

  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "child-semester-1",
    grade: 4,
    weekday: "mon",
    now: new Date("2026-08-17T10:00:00.000Z"),
  });

  const schoolCandidates = candidates.filter((c) => c.schoolContextTag === "school_required");
  assert.ok(schoolCandidates.length > 0, "학기 중에는 school_required 질문이 노출되어야 함");
});

test("078-C-3: 컨텍스트 없음(신규 아이) 시 차단하지 않는다 (SEMESTER fail-safe)", async () => {
  const questionRows = [
    ...Array.from({ length: 10 }, (_, i) => makeQuestionRow({
      id: `q-univ-${i + 1}`,
      question_text: `일반 질문 ${i + 1}`,
      semantic_group: `UNIV_GROUP_${i + 1}`,
      school_context_tag: "universal",
    })),
    ...Array.from({ length: 5 }, (_, i) => makeQuestionRow({
      id: `q-school-${i + 1}`,
      question_text: `학교 질문 ${i + 1}`,
      semantic_group: `SCHOOL_GROUP_${i + 1}`,
      school_context_tag: "school_required",
    })),
  ];
  const { db } = makeDb(questionRows, [], []); // 기록 없음

  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "child-new-no-context",
    grade: 4,
    weekday: "mon",
    now: new Date("2026-08-17T10:00:00.000Z"),
  });

  const schoolCandidates = candidates.filter((c) => c.schoolContextTag === "school_required");
  assert.ok(schoolCandidates.length > 0, "기록이 없는 신규 아이는 기본 학기(SEMESTER)로 처리되어 차단되지 않아야 함");
});

test("078-C-4: 컨텍스트 조회 실패 시 차단하지 않고 대화를 계속한다 (fail-safe)", async () => {
  const questionRows = [
    ...Array.from({ length: 10 }, (_, i) => makeQuestionRow({
      id: `q-univ-${i + 1}`,
      question_text: `일반 질문 ${i + 1}`,
      semantic_group: `UNIV_GROUP_${i + 1}`,
      school_context_tag: "universal",
    })),
    ...Array.from({ length: 5 }, (_, i) => makeQuestionRow({
      id: `q-school-${i + 1}`,
      question_text: `학교 질문 ${i + 1}`,
      semantic_group: `SCHOOL_GROUP_${i + 1}`,
      school_context_tag: "school_required",
    })),
  ];
  const { db } = makeDb(questionRows, [], [], { errorOnTemporal: true });

  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "child-db-err",
    grade: 4,
    weekday: "mon",
    now: new Date("2026-08-17T10:00:00.000Z"),
  });

  assert.ok(candidates.length >= 10, "DB 오류 시에도 대화가 죽지 않고 Goal 후보가 반환되어야 함");
  const schoolCandidates = candidates.filter((c) => c.schoolContextTag === "school_required");
  assert.ok(schoolCandidates.length > 0, "조회 실패 시 fail-safe로 학교 질문이 차단되지 않음");
});

test("078-C-5: 방학 차단으로 후보가 줄어도 Goal 은 정확히 10개다", async () => {
  // universal 7개 + school_required 8개 -> 방학 차단 시 7개만 남음
  const questionRows = [
    ...Array.from({ length: 7 }, (_, i) => makeQuestionRow({
      id: `q-univ-${i + 1}`,
      question_text: `일반 질문 ${i + 1}`,
      semantic_group: `UNIV_GROUP_${i + 1}`,
      school_context_tag: "universal",
    })),
    ...Array.from({ length: 8 }, (_, i) => makeQuestionRow({
      id: `q-school-${i + 1}`,
      question_text: `학교 질문 ${i + 1}`,
      semantic_group: `SCHOOL_GROUP_${i + 1}`,
      school_context_tag: "school_required",
    })),
  ];
  const temporalRows = [
    {
      id: "ctx-5",
      child_id: "child-scarce-vacation",
      context_type: "vacation_school",
      status: "VACATION_CONFIRMED",
      expected_school_start_date: "2026-09-01",
      school_question_block_until: "2026-08-31",
      confirmation_status: null,
      last_asked_business_date: null,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
      expired_at: null,
    },
  ];
  const { db } = makeDb(questionRows, [], temporalRows);

  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "child-scarce-vacation",
    grade: 4,
    weekday: "mon",
    now: new Date("2026-08-17T10:00:00.000Z"),
  });

  const goals = selectConversationGoalDrafts({
    missionSessionId: "sess-scarce-vacation",
    childId: "child-scarce-vacation",
    candidates,
  });

  assert.equal(goals.length, 10, "방학 차단으로 후보가 줄어도 완화(Step 4 fallback)를 거쳐 정확히 10개 Goal 보장");
  const uniqueGroups = new Set(goals.map((g) => g.semanticGroup));
  assert.equal(uniqueGroups.size, 10);
});

test("078-C-6: 완화 단계에서 school_required 가 되살아나지 않는다", async () => {
  // 5개 universal 질문이 모두 7일 내 사용된 상태 + school_required 질문이 10개 있음
  const questionRows = [
    ...Array.from({ length: 5 }, (_, i) => makeQuestionRow({
      id: `q-univ-${i + 1}`,
      question_text: `일반 질문 ${i + 1}`,
      semantic_group: `UNIV_GROUP_${i + 1}`,
      school_context_tag: "universal",
    })),
    ...Array.from({ length: 10 }, (_, i) => makeQuestionRow({
      id: `q-school-${i + 1}`,
      question_text: `학교 질문 ${i + 1}`,
      semantic_group: `SCHOOL_GROUP_${i + 1}`,
      school_context_tag: "school_required",
    })),
  ];
  const progressRows = [
    {
      session_id: "prev-sess-1",
      child_id: "child-relax-test",
      question_ids: ["q-univ-1", "q-univ-2", "q-univ-3", "q-univ-4", "q-univ-5"],
      created_at: new Date("2026-08-15T00:00:00.000Z").toISOString(),
    },
  ];
  const temporalRows = [
    {
      id: "ctx-6",
      child_id: "child-relax-test",
      context_type: "vacation_school",
      status: "VACATION_CONFIRMED",
      expected_school_start_date: "2026-09-01",
      school_question_block_until: "2026-08-31",
      confirmation_status: null,
      last_asked_business_date: null,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
      expired_at: null,
    },
  ];
  const { db } = makeDb(questionRows, progressRows, temporalRows);

  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "child-relax-test",
    grade: 4,
    weekday: "mon",
    now: new Date("2026-08-17T10:00:00.000Z"),
  });

  const goals = selectConversationGoalDrafts({
    missionSessionId: "sess-relax-test",
    childId: "child-relax-test",
    candidates,
  });

  assert.equal(goals.length, 10, "Goal은 정확히 10개여야 함");
  const schoolCandidatesInResult = candidates.filter((c) => c.schoolContextTag === "school_required");
  assert.equal(schoolCandidatesInResult.length, 0, "Stepwise relaxation 단계에서도 school_required 질문은 절대 부활하지 않아야 함");
});

test("078-C-7: school_context_tag 컬럼이 없어도 터지지 않는다 (fallback 쿼리 동작)", async () => {
  const questionRows = Array.from({ length: 12 }, (_, i) => {
    const row = makeQuestionRow({
      id: `q-notag-${i + 1}`,
      question_text: `노태그 질문 ${i + 1}`,
      semantic_group: `NOTAG_GROUP_${i + 1}`,
    });
    delete (row as Record<string, unknown>).school_context_tag;
    return row;
  });
  const { db } = makeDb(questionRows, [], [], { errorOnSchoolContextTag: true });

  const candidates = await loadMissionQuestionGoalCandidates({
    db,
    childId: "child-notag",
    grade: 4,
    weekday: "mon",
  });

  assert.ok(candidates.length >= 10, "school_context_tag 컬럼이 없어도 fallback 쿼리로 정상 조회되어야 함");
  const goals = selectConversationGoalDrafts({
    missionSessionId: "sess-notag",
    childId: "child-notag",
    candidates,
  });
  assert.equal(goals.length, 10);
});
