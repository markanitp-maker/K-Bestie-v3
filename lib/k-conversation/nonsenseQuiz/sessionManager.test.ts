import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  NonsenseGameSessionRow,
  NonsenseQuestionHistoryRow,
  NonsenseQuestionRow,
} from "./nonsenseQuizTypes";
import {
  getActiveNonsenseSession,
  startNonsenseSession,
  advanceHintLevel,
  finishQuestionRound,
  endNonsenseSession,
} from "./sessionManager";

const mockQuestion: NonsenseQuestionRow = {
  id: "NQ0001",
  concept_key: "nq-0001-풋사과",
  question: "사과가 웃으면?",
  canonical_answer: "풋사과",
  accepted_answers: ["풋사과"],
  hint_1: "정답은 3글자예요.",
  hint_2: "‘풋’으로 시작해요.",
  explanation: "풋사과 말장난입니다.",
  category: "FOOD",
  pun_type: "WORD_COMBINATION",
  difficulty: 1,
  min_grade: 1,
  max_grade: 4,
  status: "ACTIVE",
  child_safe: true,
};

function createMockSupabase(): {
  db: SupabaseClient;
  sessions: NonsenseGameSessionRow[];
  histories: NonsenseQuestionHistoryRow[];
} {
  const sessions: NonsenseGameSessionRow[] = [];
  const histories: NonsenseQuestionHistoryRow[] = [];

  const db = {
    from: (table: string) => {
      if (table === "nonsense_game_sessions") {
        return {
          select: () => ({
            eq: (col: string, val: any) => ({
              is: (col2: string, val2: any) => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => {
                      const found = sessions.find(
                        (s) => s.child_id === val && (val2 === null ? s.ended_at === null : true)
                      );
                      return { data: found || null, error: null };
                    },
                  }),
                }),
              }),
            }),
          }),
          insert: (data: any) => ({
            select: () => ({
              single: async () => {
                const row = { id: `session-${sessions.length + 1}`, ...data };
                sessions.push(row);
                return { data: row, error: null };
              },
            }),
          }),
          update: (updates: any) => ({
            eq: (col: string, val: any) => ({
              eq: (col2: string, val2: any) => {
                for (const s of sessions) {
                  if (s[col as keyof NonsenseGameSessionRow] === val && s[col2 as keyof NonsenseGameSessionRow] === val2) {
                    Object.assign(s, updates);
                  }
                }
                return Promise.resolve({ data: null, error: null });
              },
            }),
          }),
          delete: () => ({
            eq: (col: string, val: any) => ({
              eq: (col2: string, val2: any) => {
                const idx = sessions.findIndex(
                  (s) => s[col as keyof NonsenseGameSessionRow] === val && s[col2 as keyof NonsenseGameSessionRow] === val2
                );
                if (idx !== -1) {
                  sessions.splice(idx, 1);
                }
                return Promise.resolve({ data: null, error: null });
              },
            }),
          }),
        };
      }
      if (table === "nonsense_question_history") {
        return {
          select: () => ({
            eq: (col: string, val: any) => Promise.resolve({ data: histories.filter((h) => h.child_id === val), error: null }),
          }),
          insert: (data: any) => ({
            select: () => ({
              single: async () => {
                const row = { id: `history-${histories.length + 1}`, ...data };
                histories.push(row);
                return { data: row, error: null };
              },
            }),
          }),
          update: (updates: any) => ({
            eq: (col: string, val: any) => ({
              eq: (col2: string, val2: any) => ({
                eq: (col3: string, val3: any) => {
                  for (const h of histories) {
                    if (
                      h[col as keyof NonsenseQuestionHistoryRow] === val &&
                      h[col2 as keyof NonsenseQuestionHistoryRow] === val2 &&
                      h[col3 as keyof NonsenseQuestionHistoryRow] === val3
                    ) {
                      Object.assign(h, updates);
                    }
                  }
                  return Promise.resolve({ data: null, error: null });
                },
              }),
            }),
          }),
        };
      }
      return {};
    },
  } as unknown as SupabaseClient;

  return { db, sessions, histories };
}

test("SessionManager: startNonsenseSession 실행 시 PRESENTED 이력과 세션이 원자적으로 생성된다", async () => {
  const { db, sessions, histories } = createMockSupabase();

  const { session, history } = await startNonsenseSession(db, {
    childId: "child-123",
    chatSessionId: "chat-456",
    question: mockQuestion,
    initialDifficulty: 1,
  });

  assert.ok(session.id);
  assert.equal(session.child_id, "child-123");
  assert.equal(session.state, "WAITING_FOR_ANSWER");
  assert.equal(session.current_question_id, "NQ0001");
  assert.equal(session.hint_level, 0);

  // PRESENTED 이력이 생성되었는지 검증 (§3-5)
  assert.ok(history.id);
  assert.equal(history.child_id, "child-123");
  assert.equal(history.question_id, "NQ0001");
  assert.equal(history.outcome, "PRESENTED");
  assert.equal(history.hint_count, 0);
  assert.ok(history.presented_at);

  assert.equal(sessions.length, 1);
  assert.equal(histories.length, 1);
});

test("SessionManager: advanceHintLevel로 세션 힌트 레벨과 이력 힌트 수가 갱신된다", async () => {
  const { db, sessions, histories } = createMockSupabase();

  const { session } = await startNonsenseSession(db, {
    childId: "child-123",
    chatSessionId: "chat-456",
    question: mockQuestion,
  });

  await advanceHintLevel(db, session.id, "NQ0001", "child-123", 1);

  assert.equal(sessions[0].hint_level, 1);
  assert.equal(sessions[0].state, "HINT");
  assert.equal(histories[0].hint_count, 1);
});

test("SessionManager: finishQuestionRound로 정답 결과 및 종료 시간이 저장된다", async () => {
  const { db, sessions, histories } = createMockSupabase();

  const { session } = await startNonsenseSession(db, {
    childId: "child-123",
    chatSessionId: "chat-456",
    question: mockQuestion,
  });

  await finishQuestionRound(db, {
    sessionId: session.id,
    childId: "child-123",
    questionId: "NQ0001",
    outcome: "ANSWERED_CORRECT",
    hintCount: 1,
    endSession: true,
  });

  assert.equal(histories[0].outcome, "ANSWERED_CORRECT");
  assert.ok(histories[0].answered_at);
  assert.equal(histories[0].hint_count, 1);
  assert.ok(sessions[0].ended_at);
});

test("SessionManager: endNonsenseSession으로 세션이 ENDED 상태가 되고 미결 이력이 정리된다", async () => {
  const { db, sessions, histories } = createMockSupabase();

  const { session } = await startNonsenseSession(db, {
    childId: "child-123",
    chatSessionId: "chat-456",
    question: mockQuestion,
  });

  await endNonsenseSession(db, session.id, "child-123", "TOPIC_SHIFT");

  assert.equal(sessions[0].state, "ENDED");
  assert.ok(sessions[0].ended_at);
  // 아직 PRESENTED였던 항목은 TOPIC_SHIFT로 정리
  assert.equal(histories[0].outcome, "TOPIC_SHIFT");
});

test("SessionManager: startNonsenseSession에서 세션 insert가 실패하면 throw하고 가짜 세션을 생성하지 않는다", async () => {
  const db = {
    from: (table: string) => {
      if (table === "nonsense_game_sessions") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: new Error("DB Connection Error") }),
            }),
          }),
        };
      }
      return {};
    },
  } as unknown as SupabaseClient;

  await assert.rejects(
    async () => {
      await startNonsenseSession(db, {
        childId: "child-fail",
        chatSessionId: "chat-fail",
        question: mockQuestion,
      });
    },
    /Session insert failed/
  );
});

test("SessionManager: startNonsenseSession에서 이력 insert가 실패하면 throw하고 생성된 세션을 정리한다", async () => {
  const sessions: NonsenseGameSessionRow[] = [];
  const db = {
    from: (table: string) => {
      if (table === "nonsense_game_sessions") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
          insert: (data: any) => ({
            select: () => ({
              single: async () => {
                const row = { id: `session-1`, ...data };
                sessions.push(row);
                return { data: row, error: null };
              },
            }),
          }),
          delete: () => ({
            eq: (col: string, val: any) => ({
              eq: (col2: string, val2: any) => {
                const idx = sessions.findIndex(
                  (s) => s[col as keyof NonsenseGameSessionRow] === val && s[col2 as keyof NonsenseGameSessionRow] === val2
                );
                if (idx !== -1) {
                  sessions.splice(idx, 1);
                }
                return Promise.resolve({ data: null, error: null });
              },
            }),
          }),
        };
      }
      if (table === "nonsense_question_history") {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: new Error("History Insert Error") }),
            }),
          }),
        };
      }
      return {};
    },
  } as unknown as SupabaseClient;

  await assert.rejects(
    async () => {
      await startNonsenseSession(db, {
        childId: "child-hist-fail",
        chatSessionId: "chat-hist-fail",
        question: mockQuestion,
      });
    },
    /History insert failed/
  );

  // 이력 실패로 인해 세션이 롤백(삭제)되어 세션 목록이 비어있어야 함
  assert.equal(sessions.length, 0);
});

