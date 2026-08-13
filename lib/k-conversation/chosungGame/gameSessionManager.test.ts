import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  startChosungGameSession,
  getActiveChosungGameSession,
  submitChosungAnswer,
  nextChosungRound,
  endChosungGameSession,
  type ChosungGameSessionRow,
  type ChosungGameRoundRow,
} from "./gameSessionManager";

/**
 * 실제 테이블 스키마(20260811000000_chosung_game_state.sql)의 모든 컬럼을 갖춘 mock DB 팩토리
 */
function createMockSupabase(options?: {
  sessions?: ChosungGameSessionRow[];
  rounds?: ChosungGameRoundRow[];
  shouldFail?: boolean;
}) {
  const sessionsStore: ChosungGameSessionRow[] = options?.sessions ? [...options.sessions] : [];
  const roundsStore: ChosungGameRoundRow[] = options?.rounds ? [...options.rounds] : [];
  const shouldFail = options?.shouldFail ?? false;

  return {
    from(tableName: string) {
      if (shouldFail) {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: "Mock DB insert error" } }) }) }),
          select: () => ({
            eq: () => ({
              is: () => ({
                single: async () => ({ data: null, error: { message: "Mock DB query error" } }),
                maybeSingle: async () => ({ data: null, error: { message: "Mock DB query error" } }),
              }),
              single: async () => ({ data: null, error: { message: "Mock DB query error" } }),
              order: () => ({ limit: async () => ({ data: null, error: { message: "Mock DB query error" } }) }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: "Mock DB update error" } }) }) }),
                select: () => ({ single: async () => ({ data: null, error: { message: "Mock DB update error" } }) }),
              }),
              select: () => ({ single: async () => ({ data: null, error: { message: "Mock DB update error" } }) }),
            }),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      if (tableName === "chosung_game_sessions") {
        return {
          insert: (payload: Partial<ChosungGameSessionRow>) => {
            const newRow: ChosungGameSessionRow = {
              id: payload.id || `session-${Date.now()}-${Math.random()}`,
              child_id: payload.child_id!,
              chat_session_id: payload.chat_session_id!,
              state: payload.state || "PLAYING_K_ASKS",
              initiated_by: payload.initiated_by || "K",
              current_word: payload.current_word || null,
              current_chosung: payload.current_chosung || null,
              current_category: payload.current_category || null,
              current_difficulty: payload.current_difficulty ?? 1,
              hint_level: payload.hint_level ?? 0,
              recent_words: payload.recent_words || [],
              started_at: payload.started_at || new Date().toISOString(),
              updated_at: payload.updated_at || new Date().toISOString(),
              ended_at: payload.ended_at || null,
            };
            sessionsStore.push(newRow);
            return {
              select: () => ({
                single: async () => ({ data: newRow, error: null }),
              }),
            };
          },
          select: (_cols?: string) => {
            let filtered = [...sessionsStore];
            const queryBuilder = {
              eq: (col: string, val: any) => {
                filtered = filtered.filter((r) => (r as any)[col] === val);
                return queryBuilder;
              },
              is: (col: string, val: any) => {
                filtered = filtered.filter((r) => (r as any)[col] === val);
                return queryBuilder;
              },
              single: async () => {
                if (filtered.length === 0) {
                  return { data: null, error: { message: "Row not found" } };
                }
                return { data: filtered[0], error: null };
              },
              maybeSingle: async () => {
                return { data: filtered[0] || null, error: null };
              },
            };
            return queryBuilder;
          },
          update: (payload: Partial<ChosungGameSessionRow>) => {
            let targetId: string | null = null;
            let targetChildId: string | null = null;
            let checkEndedNull = false;

            const queryBuilder = {
              eq: (col: string, val: any) => {
                if (col === "id") targetId = val;
                if (col === "child_id") targetChildId = val;
                return queryBuilder;
              },
              is: (col: string, val: any) => {
                if (col === "ended_at" && val === null) checkEndedNull = true;
                return queryBuilder;
              },
              select: () => ({
                single: async () => {
                  const idx = sessionsStore.findIndex((r) => {
                    if (targetId && r.id !== targetId) return false;
                    if (targetChildId && r.child_id !== targetChildId) return false;
                    if (checkEndedNull && r.ended_at !== null) return false;
                    return true;
                  });

                  if (idx === -1) {
                    return { data: null, error: { message: "Session update target not found" } };
                  }

                  sessionsStore[idx] = {
                    ...sessionsStore[idx],
                    ...payload,
                    updated_at: new Date().toISOString(),
                  };
                  return { data: sessionsStore[idx], error: null };
                },
              }),
            };
            return queryBuilder;
          },
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      if (tableName === "chosung_game_rounds") {
        return {
          insert: (payload: Partial<ChosungGameRoundRow>) => {
            const newRound: ChosungGameRoundRow = {
              id: payload.id || `round-${Date.now()}-${Math.random()}`,
              session_id: payload.session_id!,
              child_id: payload.child_id!,
              game_type: payload.game_type || "CHOSUNG",
              difficulty: payload.difficulty ?? 1,
              result: payload.result || "correct",
              hint_used: payload.hint_used ?? 0,
              initiated_by: payload.initiated_by || "K",
              created_at: payload.created_at || new Date().toISOString(),
            };
            roundsStore.push(newRound);
            return {
              select: () => ({
                single: async () => ({ data: newRound, error: null }),
              }),
            };
          },
          select: (_cols?: string) => {
            let filtered = [...roundsStore];
            const queryBuilder = {
              eq: (col: string, val: any) => {
                filtered = filtered.filter((r) => (r as any)[col] === val);
                return queryBuilder;
              },
              order: (_col: string, _opts?: any) => {
                filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                return queryBuilder;
              },
              limit: async (lim: number) => {
                return { data: filtered.slice(0, lim), error: null };
              },
            };
            return queryBuilder;
          },
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      throw new Error(`Unexpected table: ${tableName}`);
    },
  } as unknown as SupabaseClient;
}

test("1. 세션 시작 시 학년별 기본 난이도가 적용된다", async () => {
  const db1 = createMockSupabase();
  const sessionG1 = await startChosungGameSession(db1, {
    childId: "child-g1",
    chatSessionId: "chat-s1",
    gradeRaw: 1,
  });
  assert.equal(sessionG1.current_difficulty, 1);
  assert.ok(sessionG1.current_word);
  assert.ok(sessionG1.current_chosung);

  const db3 = createMockSupabase();
  const sessionG3 = await startChosungGameSession(db3, {
    childId: "child-g3",
    chatSessionId: "chat-s3",
    gradeRaw: 3,
  });
  assert.equal(sessionG3.current_difficulty, 3);

  const db6 = createMockSupabase();
  const sessionG6 = await startChosungGameSession(db6, {
    childId: "child-g6",
    chatSessionId: "chat-s6",
    gradeRaw: 6,
  });
  assert.equal(sessionG6.current_difficulty, 5);
});

test("2. 힌트 없이 2연속 정답 시 난이도가 오르고 세션 상태가 갱신된다", async () => {
  const db = createMockSupabase();
  const session = await startChosungGameSession(db, {
    childId: "child-adaptive-1",
    chatSessionId: "chat-1",
    gradeRaw: 3, // base: 3, min: 2, max: 4
  });

  // 라운드 1 정답
  const res1 = await submitChosungAnswer(db, {
    sessionId: session.id,
    childId: session.child_id,
    userAnswer: session.current_word!,
    gradeRaw: 3,
    hintUsed: 0,
  });
  assert.equal(res1.isCorrect, true);

  // 라운드 2 정답 (2연속 정답 -> difficulty 3에서 4로 상승)
  const res2 = await submitChosungAnswer(db, {
    sessionId: session.id,
    childId: session.child_id,
    userAnswer: session.current_word!,
    gradeRaw: 3,
    hintUsed: 0,
  });
  assert.equal(res2.isCorrect, true);
  assert.equal(res2.nextDifficulty, 4);

  const active = await getActiveChosungGameSession(db, session.child_id);
  assert.equal(active?.current_difficulty, 4);
  assert.equal(active?.state, "ROUND_RESULT");
});

test("3. 오답 시 난이도가 내려가되 학년 하한 이하로는 안 내려간다", async () => {
  const db = createMockSupabase();
  const session = await startChosungGameSession(db, {
    childId: "child-min-bound",
    chatSessionId: "chat-2",
    gradeRaw: 3, // min: 2, max: 4, base: 3
  });

  // 먼저 난이도를 2(하한)로 낮추기 위한 연속 오답
  const res1 = await submitChosungAnswer(db, {
    sessionId: session.id,
    childId: session.child_id,
    roundResult: "skip",
    gradeRaw: 3,
  });

  const res2 = await submitChosungAnswer(db, {
    sessionId: session.id,
    childId: session.child_id,
    roundResult: "revealed",
    gradeRaw: 3,
  });
  assert.equal(res2.nextDifficulty, 2); // 하한 2로 하강

  // 하한 상태에서 추가 오답 발생 시에도 학년 하한(2) 미만으로 하강 방지
  const res3 = await submitChosungAnswer(db, {
    sessionId: session.id,
    childId: session.child_id,
    roundResult: "skip",
  });
  assert.equal(res3.nextDifficulty, 2); // 1로 안 내려가고 2 유지
});

test("4. 한 세션 안에서 이미 나온 단어는 중복 출제되지 않는다", async () => {
  const db = createMockSupabase();
  let session = await startChosungGameSession(db, {
    childId: "child-no-dup",
    chatSessionId: "chat-3",
    gradeRaw: 1,
  });

  const seenWords = new Set<string>([session.current_word!]);

  for (let i = 0; i < 5; i++) {
    session = await nextChosungRound(db, {
      sessionId: session.id,
      childId: session.child_id,
      gradeRaw: 1,
    });
    assert.equal(seenWords.has(session.current_word!), false);
    seenWords.add(session.current_word!);
  }

  assert.equal(session.recent_words.length, 6);
  assert.equal(seenWords.size, 6);
});

test("5. DB 오류 시 조용히 성공하지 않고 예외를 던진다", async () => {
  const failingDb = createMockSupabase({ shouldFail: true });

  await assert.rejects(
    async () => {
      await startChosungGameSession(failingDb, {
        childId: "child-err",
        chatSessionId: "chat-err",
      });
    },
    /gameSessionManager/
  );

  await assert.rejects(
    async () => {
      await getActiveChosungGameSession(failingDb, "child-err");
    },
    /gameSessionManager/
  );

  await assert.rejects(
    async () => {
      await submitChosungAnswer(failingDb, {
        sessionId: "sess-err",
        childId: "child-err",
      });
    },
    /gameSessionManager/
  );

  await assert.rejects(
    async () => {
      await nextChosungRound(failingDb, {
        sessionId: "sess-err",
        childId: "child-err",
      });
    },
    /gameSessionManager/
  );

  await assert.rejects(
    async () => {
      await endChosungGameSession(failingDb, {
        sessionId: "sess-err",
        childId: "child-err",
      });
    },
    /gameSessionManager/
  );
});
