import assert from "node:assert/strict";
import { test, describe } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  startWordChainSession,
  getActiveWordChainSession,
  recordWordChainTurn,
  endWordChainSession,
  getDerivedRoundCount,
  getRequiredStartSyllable,
  type WordChainSessionRow,
  type WordChainRoundRow,
} from "./sessionManager";

/**
 * word_chain_game_sessions 및 word_chain_game_rounds 테이블 모킹 DB 팩토리
 */
function createMockSupabase(options?: {
  sessions?: WordChainSessionRow[];
  rounds?: WordChainRoundRow[];
  chatSessions?: Array<{ id: string; child_id: string }>;
  shouldFail?: boolean;
}) {
  const sessionsStore: WordChainSessionRow[] = options?.sessions
    ? [...options.sessions]
    : [];
  const roundsStore: WordChainRoundRow[] = options?.rounds
    ? [...options.rounds]
    : [];
  const chatSessionsStore = options?.chatSessions
    ? [...options.chatSessions]
    : [
        { id: "chat-sess-1", child_id: "child-derived-1" },
        { id: "chat-sess-2", child_id: "child-derived-2" },
      ];
  const shouldFail = options?.shouldFail ?? false;

  return {
    from(tableName: string) {
      if (shouldFail) {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: null,
                error: { message: "Mock DB insert error" },
              }),
            }),
          }),
          select: () => {
            const err = {
              data: null,
              error: { message: "Mock DB select error" },
            };
            const node: Record<string, unknown> = {};
            const chain = () => node;
            for (const method of [
              "eq",
              "is",
              "not",
              "in",
              "order",
              "gte",
              "lte",
              "neq",
            ]) {
              node[method] = chain;
            }
            node.limit = async () => err;
            node.single = async () => err;
            node.maybeSingle = async () => err;
            return node;
          },
          update: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  select: () => ({
                    single: async () => ({
                      data: null,
                      error: { message: "Mock DB update error" },
                    }),
                  }),
                }),
                select: () => ({
                  single: async () => ({
                    data: null,
                    error: { message: "Mock DB update error" },
                  }),
                }),
              }),
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { message: "Mock DB update error" },
                }),
              }),
            }),
          }),
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      if (tableName === "chat_sessions") {
        return {
          select: (_cols?: string) => {
            let filtered = [...chatSessionsStore];
            const builder: any = {
              eq: (col: string, val: any) => {
                filtered = filtered.filter((r) => (r as any)[col] === val);
                return builder;
              },
              maybeSingle: async () => {
                return { data: filtered[0] || null, error: null };
              },
              single: async () => {
                if (filtered.length === 0) {
                  return {
                    data: null,
                    error: { message: "Chat session not found" },
                  };
                }
                return { data: filtered[0], error: null };
              },
            };
            return builder;
          },
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      if (tableName === "word_chain_game_sessions") {
        return {
          insert: (payload: Partial<WordChainSessionRow>) => {
            const newRow: WordChainSessionRow = {
              id: payload.id || `session-${Date.now()}-${Math.random()}`,
              child_id: payload.child_id!,
              chat_session_id: payload.chat_session_id!,
              initiated_by: payload.initiated_by || "K",
              state: payload.state || "CHILD_TURN",
              current_word: payload.current_word || null,
              current_difficulty: payload.current_difficulty ?? 1,
              used_words: payload.used_words ? [...payload.used_words] : [],
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
            const queryBuilder: any = {
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
          update: (payload: Partial<WordChainSessionRow>) => {
            let targetFilter: Record<string, any> = {};
            const updateBuilder: any = {
              eq: (col: string, val: any) => {
                targetFilter[col] = val;
                return updateBuilder;
              },
              is: (col: string, val: any) => {
                targetFilter[col] = val;
                return updateBuilder;
              },
              select: () => ({
                single: async () => {
                  const target = sessionsStore.find((r) => {
                    return Object.entries(targetFilter).every(
                      ([k, v]) => (r as any)[k] === v
                    );
                  });
                  if (!target) {
                    return {
                      data: null,
                      error: { message: "Update target not found" },
                    };
                  }
                  Object.assign(target, payload);
                  return { data: target, error: null };
                },
              }),
              then: (resolve: any) => {
                const target = sessionsStore.find((r) => {
                  return Object.entries(targetFilter).every(
                    ([k, v]) => (r as any)[k] === v
                  );
                });
                if (target) {
                  Object.assign(target, payload);
                }
                resolve({ error: null });
              },
            };
            return updateBuilder;
          },
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      if (tableName === "word_chain_game_rounds") {
        return {
          insert: (payload: Partial<WordChainRoundRow>) => {
            const newRound: WordChainRoundRow = {
              id: payload.id || `round-${Date.now()}-${Math.random()}`,
              session_id: payload.session_id!,
              child_id: payload.child_id!,
              word: payload.word!,
              by: payload.by!,
              difficulty: payload.difficulty ?? 1,
              result: payload.result!,
              created_at: payload.created_at || new Date().toISOString(),
            };
            roundsStore.push(newRound);
            return {
              select: () => ({
                single: async () => ({ data: newRound, error: null }),
              }),
            };
          },
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      throw new Error(`Unhandled mock table: ${tableName}`);
    },
  } as unknown as SupabaseClient;
}

describe("WordChain sessionManager", () => {
  test("startWordChainSession은 chat_sessions에서 child_id를 안전하게 파생한다 (§5)", async () => {
    const mockDb = createMockSupabase();

    const session = await startWordChainSession(mockDb, {
      chatSessionId: "chat-sess-1",
      initialWord: "사과",
      initialDifficulty: 2,
    });

    assert.equal(session.child_id, "child-derived-1");
    assert.equal(session.chat_session_id, "chat-sess-1");
    assert.equal(session.current_word, "사과");
    assert.equal(session.current_difficulty, 2);
    assert.deepEqual(session.used_words, ["사과"]);
    assert.equal(session.state, "CHILD_TURN");
    assert.equal(session.ended_at, null);
  });

  test("활성 세션이 이미 존재하면 startWordChainSession은 중복 생성하지 않고 기존 세션을 반환한다", async () => {
    const existingSession: WordChainSessionRow = {
      id: "existing-session-123",
      child_id: "child-derived-1",
      chat_session_id: "chat-sess-1",
      initiated_by: "K",
      state: "CHILD_TURN",
      current_word: "바나나",
      current_difficulty: 2,
      used_words: ["사과", "과자", "자전거", "거미", "미나리", "리본", "본드", "드럼", "럼주", "주전자", "자석", "석탄", "탄산", "산수", "수박", "박수", "수영", "영화", "하늘", "늘보", "보석", "석유", "유리", "리본", "바나나"],
      started_at: "2026-08-16T12:00:00.000Z",
      updated_at: "2026-08-16T12:05:00.000Z",
      ended_at: null,
    };

    const mockDb = createMockSupabase({
      sessions: [existingSession],
    });

    const returnedSession = await startWordChainSession(mockDb, {
      chatSessionId: "chat-sess-1",
      initialWord: "포도",
    });

    assert.equal(returnedSession.id, "existing-session-123");
    assert.equal(returnedSession.current_word, "바나나");
    assert.equal(returnedSession.used_words.length, 25);
  });

  test("recordWordChainTurn에서 ACCEPTED 단어는 current_word와 used_words에 누적된다", async () => {
    const existingSession: WordChainSessionRow = {
      id: "session-play-1",
      child_id: "child-derived-1",
      chat_session_id: "chat-sess-1",
      initiated_by: "K",
      state: "CHILD_TURN",
      current_word: "사과",
      current_difficulty: 1,
      used_words: ["사과"],
      started_at: "2026-08-16T12:00:00.000Z",
      updated_at: "2026-08-16T12:00:00.000Z",
      ended_at: null,
    };

    const mockDb = createMockSupabase({
      sessions: [existingSession],
    });

    // 아이 턴: 과자 (ACCEPTED)
    const afterChildTurn = await recordWordChainTurn(mockDb, {
      sessionId: "session-play-1",
      childId: "child-derived-1",
      word: "과자",
      by: "CHILD",
      result: "ACCEPTED",
      difficulty: 1,
    });

    assert.equal(afterChildTurn.session.current_word, "과자");
    assert.deepEqual(afterChildTurn.session.used_words, ["사과", "과자"]);
    assert.equal(afterChildTurn.session.state, "K_TURN");

    // K 턴: 자전거 (ACCEPTED)
    const afterKTurn = await recordWordChainTurn(mockDb, {
      sessionId: "session-play-1",
      childId: "child-derived-1",
      word: "자전거",
      by: "K",
      result: "ACCEPTED",
      difficulty: 1,
    });

    assert.equal(afterKTurn.session.current_word, "자전거");
    assert.deepEqual(afterKTurn.session.used_words, ["사과", "과자", "자전거"]);
    assert.equal(afterKTurn.session.state, "CHILD_TURN");
  });

  test("recordWordChainTurn에서 거절(CHAIN_MISMATCH 등)된 단어는 current_word와 used_words를 변경하지 않는다", async () => {
    const existingSession: WordChainSessionRow = {
      id: "session-reject-1",
      child_id: "child-derived-1",
      chat_session_id: "chat-sess-1",
      initiated_by: "K",
      state: "CHILD_TURN",
      current_word: "사과",
      current_difficulty: 1,
      used_words: ["사과"],
      started_at: "2026-08-16T12:00:00.000Z",
      updated_at: "2026-08-16T12:00:00.000Z",
      ended_at: null,
    };

    const mockDb = createMockSupabase({
      sessions: [existingSession],
    });

    const rejectedTurn = await recordWordChainTurn(mockDb, {
      sessionId: "session-reject-1",
      childId: "child-derived-1",
      word: "바나나",
      by: "CHILD",
      result: "CHAIN_MISMATCH",
      difficulty: 1,
      nextState: "CHILD_TURN",
    });

    assert.equal(rejectedTurn.session.current_word, "사과");
    assert.deepEqual(rejectedTurn.session.used_words, ["사과"]);
    assert.equal(rejectedTurn.session.state, "CHILD_TURN");
  });

  test("endWordChainSession 후에는 getActiveWordChainSession이 null을 반환한다", async () => {
    const existingSession: WordChainSessionRow = {
      id: "session-end-1",
      child_id: "child-derived-1",
      chat_session_id: "chat-sess-1",
      initiated_by: "K",
      state: "CHILD_TURN",
      current_word: "사과",
      current_difficulty: 1,
      used_words: ["사과"],
      started_at: "2026-08-16T12:00:00.000Z",
      updated_at: "2026-08-16T12:00:00.000Z",
      ended_at: null,
    };

    const mockDb = createMockSupabase({
      sessions: [existingSession],
    });

    // 종료 전 활성 세션 조회
    const beforeEnd = await getActiveWordChainSession(mockDb, "child-derived-1");
    assert.notEqual(beforeEnd, null);
    assert.equal(beforeEnd?.id, "session-end-1");

    // 세션 종료
    await endWordChainSession(mockDb, "session-end-1", "child-derived-1");

    // 종료 후 활성 세션 조회 -> null
    const afterEnd = await getActiveWordChainSession(mockDb, "child-derived-1");
    assert.equal(afterEnd, null);
  });

  test("DB 실패 시에도 예외를 throw하지 않고 안전하게 처리된다", async () => {
    const failingDb = createMockSupabase({ shouldFail: true });

    // startWordChainSession 예외 없이 fallback 반환
    const startResult = await startWordChainSession(failingDb, {
      chatSessionId: "chat-sess-fail",
      childId: "child-fail",
      initialWord: "사과",
    });
    assert.ok(startResult);
    assert.equal(startResult.child_id, "child-fail");

    // getActiveWordChainSession 예외 없이 null 반환
    const activeResult = await getActiveWordChainSession(failingDb, "child-fail");
    assert.equal(activeResult, null);

    // recordWordChainTurn 예외 없이 fallback 반환
    const turnResult = await recordWordChainTurn(failingDb, {
      sessionId: "session-fail",
      childId: "child-fail",
      word: "과자",
      by: "CHILD",
      result: "ACCEPTED",
    });
    assert.ok(turnResult);
    assert.equal(turnResult.session.id, "session-fail");
    // 010 §3-14 — DB 쓰기가 실패했으면 호출자가 알아야 한다. 예전에는 성공과 실패가
    // 구분되지 않아 저장되지 않은 상태로 게임이 계속 진행됐다.
    assert.equal(turnResult.persisted, false, "DB 실패인데 확정된 것으로 보고했다");

    // endWordChainSession 예외 없이 완료
    await assert.doesNotReject(async () => {
      await endWordChainSession(failingDb, "session-fail", "child-fail");
    });
  });

  test("requiredStartSyllable과 roundCount가 세션 Row 컬럼이 아니라 파생값임을 확인 (§3-10)", () => {
    const sessionRow: WordChainSessionRow = {
      id: "session-derivable-1",
      child_id: "child-1",
      chat_session_id: "chat-1",
      initiated_by: "K",
      state: "CHILD_TURN",
      current_word: "하늘",
      current_difficulty: 2,
      used_words: ["사과", "과자", "자석", "석유", "유리", "리본", "본드", "드럼", "럼주", "주전자", "자전거", "거미", "미역", "역사", "사자", "자두", "두부", "부모", "모자", "자유", "유성", "성탄", "탄산", "산수", "수영", "영화", "하늘"],
      started_at: "2026-08-16T12:00:00.000Z",
      updated_at: "2026-08-16T12:10:00.000Z",
      ended_at: null,
    };

    // 1. Row 객체에 컬럼으로 직접 존재하지 않음 (undefined)
    assert.equal((sessionRow as any).requiredStartSyllable, undefined);
    assert.equal((sessionRow as any).roundCount, undefined);

    // 2. 헬퍼 함수를 통해 런타임에 올바르게 파생됨
    const derivedRoundCount = getDerivedRoundCount(sessionRow);
    const requiredStartSyllable = getRequiredStartSyllable(sessionRow);

    assert.equal(derivedRoundCount, 27);
    assert.equal(requiredStartSyllable, "늘");

    // 3. current_word가 null일 때 파생값 null
    const emptyWordSession: WordChainSessionRow = {
      ...sessionRow,
      current_word: null,
      used_words: [],
    };
    assert.equal(getDerivedRoundCount(emptyWordSession), 0);
    assert.equal(getRequiredStartSyllable(emptyWordSession), null);
  });
});

// ── 010 §3-14 DB 확정 전 게임 진행 금지 ─────────────────────────
test("010 §3-14: 세션을 못 찾으면 확정 실패로 보고한다", async () => {
  // 세션 조회가 실패하는 상황. 예전에는 만들어진 상태를 성공처럼 돌려줬다.
  const db = createMockSupabase({ sessions: [] });
  const result = await recordWordChainTurn(db, {
    sessionId: "missing-session",
    childId: "child-1",
    word: "과자",
    by: "K",
    result: "ACCEPTED",
  });
  assert.equal(result.persisted, false);
});

test("010 §3-14: 정상 경로에서는 확정됨으로 보고한다", async () => {
  // 확정 실패 판정이 정상 게임을 막지 않는지 고정한다 — 막으면 아이 대화가 끊긴다.
  const db = createMockSupabase({
    sessions: [{
      id: "sess-ok",
      child_id: "child-1",
      chat_session_id: "chat-1",
      initiated_by: "K",
      state: "CHILD_TURN",
      current_word: "사과",
      current_difficulty: 1,
      used_words: ["사과"],
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ended_at: null,
    }],
  });
  const result = await recordWordChainTurn(db, {
    sessionId: "sess-ok",
    childId: "child-1",
    word: "과자",
    by: "CHILD",
    result: "ACCEPTED",
    nextState: "K_TURN",
  });
  assert.equal(result.persisted, true);
  assert.equal(result.session.current_word, "과자");
});
