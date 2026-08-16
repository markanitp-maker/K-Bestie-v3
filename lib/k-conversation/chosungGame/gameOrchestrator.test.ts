import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runChosungTurn, type ChosungTurnInput } from "./gameOrchestrator";
import type { ChosungGameSessionRow, ChosungGameRoundRow } from "./gameSessionManager";

/**
 * gameOrchestrator 검증용 인메모리 Mock Supabase 팩토리
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
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: { message: "Mock DB error" } }),
            }),
          }),
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  single: async () => ({ data: null, error: { message: "Mock DB error" } }),
                  maybeSingle: async () => ({ data: null, error: { message: "Mock DB error" } }),
                }),
              }),
              is: () => ({
                single: async () => ({ data: null, error: { message: "Mock DB error" } }),
                maybeSingle: async () => ({ data: null, error: { message: "Mock DB error" } }),
              }),
              order: () => ({
                limit: async () => ({ data: null, error: { message: "Mock DB error" } }),
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  select: () => ({
                    single: async () => ({ data: null, error: { message: "Mock DB error" } }),
                  }),
                }),
                select: () => ({
                  single: async () => ({ data: null, error: { message: "Mock DB error" } }),
                }),
              }),
              select: () => ({
                single: async () => ({ data: null, error: { message: "Mock DB error" } }),
              }),
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
              state: payload.state || "PLAYING_CHILD_ASKS",
              initiated_by: payload.initiated_by || "CHILD",
              current_word: payload.current_word || "사과",
              current_chosung: payload.current_chosung || "ㅅㄱ",
              current_category: payload.current_category || "음식",
              current_difficulty: payload.current_difficulty ?? 1,
              hint_level: payload.hint_level ?? 0,
              recent_words: payload.recent_words || ["사과"],
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
              initiated_by: payload.initiated_by || "CHILD",
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
              order: (_orderCol: string, _opts?: { ascending: boolean }) => queryBuilder,
              limit: async (_n: number) => ({ data: filtered, error: null }),
            };
            return queryBuilder;
          },
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      throw new Error(`Unexpected table name: ${tableName}`);
    },
  } as unknown as SupabaseClient;
}

test("1. 진행 중 세션 없음 + 시작 신호: handled: true 및 지시문에 초성 포함", async () => {
  const db = createMockSupabase();
  const input: ChosungTurnInput = {
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 1,
    utterance: "초성게임 하자",
    signals: {
      hasChosungGameStart: true,
      hasChosungAnswerAttempt: false,
      hasChosungHintRequest: false,
    },
  };

  const result = await runChosungTurn(input);
  assert.equal(result.handled, true);
  assert.ok(result.instruction);
  assert.match(result.instruction!, /\[초성게임\] 지금 낸 문제의 초성은 ".*"야\./);
  assert.match(result.instruction!, /정답 단어는 절대 말하지 마/);
});

test("2. 진행 중 세션 있음 + 정답 제출: handled: true 및 지시문에 '정답'과 다음 초성 포함", async () => {
  const initialSession: ChosungGameSessionRow = {
    id: "sess-active-1",
    child_id: "child-2",
    chat_session_id: "chat-2",
    state: "PLAYING_CHILD_ASKS",
    initiated_by: "CHILD",
    current_word: "사과",
    current_chosung: "ㅅㄱ",
    current_category: "음식",
    current_difficulty: 1,
    hint_level: 0,
    recent_words: ["사과"],
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ended_at: null,
  };

  const db = createMockSupabase({ sessions: [initialSession] });
  const input: ChosungTurnInput = {
    db,
    childId: "child-2",
    chatSessionId: "chat-2",
    gradeRaw: 1,
    utterance: "사과",
    signals: {
      hasChosungGameStart: false,
      hasChosungAnswerAttempt: true,
      hasChosungHintRequest: false,
    },
  };

  const result = await runChosungTurn(input);
  assert.equal(result.handled, true);
  assert.ok(result.instruction);
  assert.match(result.instruction!, /아이가 정답 "사과"를 맞혔어/);
  assert.match(result.instruction!, /다음 문제 초성 ".*"를 내줘/);
  assert.match(result.instruction!, /정답 단어는 절대 말하지 마/);
});

test("3. 진행 중 세션 있음 + 오답 제출: 지시문에 정답 단어가 노출되지 않음", async () => {
  const secretWord = "사과";
  const initialSession: ChosungGameSessionRow = {
    id: "sess-active-2",
    child_id: "child-3",
    chat_session_id: "chat-3",
    state: "PLAYING_CHILD_ASKS",
    initiated_by: "CHILD",
    current_word: secretWord,
    current_chosung: "ㅅㄱ",
    current_category: "음식",
    current_difficulty: 1,
    hint_level: 0,
    recent_words: [secretWord],
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ended_at: null,
  };

  const db = createMockSupabase({ sessions: [initialSession] });
  const input: ChosungTurnInput = {
    db,
    childId: "child-3",
    chatSessionId: "chat-3",
    gradeRaw: 1,
    utterance: "수박인가?",
    signals: {
      hasChosungGameStart: false,
      hasChosungAnswerAttempt: true,
      hasChosungHintRequest: false,
    },
  };

  const result = await runChosungTurn(input);
  assert.equal(result.handled, true);
  assert.ok(result.instruction);
  // 오답 시 지시문에 비밀 정답 "사과"가 노출되지 않는지 엄격 확인
  assert.equal(result.instruction!.includes(secretWord), false);
  assert.match(result.instruction!, /아이 답은 틀렸어/);
  assert.match(result.instruction!, /초성은 "ㅅㄱ"야/);
});

test("4. 진행 중 세션 있음 + 힌트 요청: 힌트 레벨 상승 및 힌트 지시문 생성", async () => {
  const secretWord = "호랑이";
  const initialSession: ChosungGameSessionRow = {
    id: "sess-active-3",
    child_id: "child-4",
    chat_session_id: "chat-4",
    state: "PLAYING_CHILD_ASKS",
    initiated_by: "CHILD",
    current_word: secretWord,
    current_chosung: "ㅎㄹㅇ",
    current_category: "동물",
    current_difficulty: 1,
    hint_level: 0,
    recent_words: [secretWord],
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ended_at: null,
  };

  const db = createMockSupabase({ sessions: [initialSession] });
  const input: ChosungTurnInput = {
    db,
    childId: "child-4",
    chatSessionId: "chat-4",
    gradeRaw: 1,
    utterance: "힌트 줘",
    signals: {
      hasChosungGameStart: false,
      hasChosungAnswerAttempt: false,
      hasChosungHintRequest: true,
    },
  };

  const result = await runChosungTurn(input);
  assert.equal(result.handled, true);
  assert.ok(result.instruction);
  assert.equal(result.instruction!.includes(secretWord), false);
  assert.match(result.instruction!, /아이가 힌트를 요청했어/);
  assert.match(result.instruction!, /초성은 "ㅎㄹㅇ"야/);
});

test("5. 초성게임 신호가 하나도 없으면 handled: false", async () => {
  const db = createMockSupabase();
  const input: ChosungTurnInput = {
    db,
    childId: "child-5",
    chatSessionId: "chat-5",
    gradeRaw: 1,
    utterance: "오늘 학교에서 축구했어",
    signals: {
      hasChosungGameStart: false,
      hasChosungAnswerAttempt: false,
      hasChosungHintRequest: false,
    },
  };

  const result = await runChosungTurn(input);
  assert.equal(result.handled, false);
  assert.equal(result.instruction, undefined);
});

test("6. DB 오류 시 throw하지 않고 fail-open (handled: false)", async () => {
  const failingDb = createMockSupabase({ shouldFail: true });
  const input: ChosungTurnInput = {
    failingDb,
    db: failingDb,
    childId: "child-err",
    chatSessionId: "chat-err",
    gradeRaw: 1,
    utterance: "초성게임 하자",
    signals: {
      hasChosungGameStart: true,
      hasChosungAnswerAttempt: false,
      hasChosungHintRequest: false,
    },
  } as unknown as ChosungTurnInput;

  // 예외를 던지지 않고 { handled: false }를 반환해야 함
  const result = await runChosungTurn(input);
  assert.equal(result.handled, false);
});
