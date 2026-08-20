import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHOSUNG_MAX_WRONG_BEFORE_REVEAL,
  CHOSUNG_REVEAL_HINT_LEVEL,
  runChosungTurn,
  type ChosungTurnInput,
} from "./gameOrchestrator";
import type { ChosungGameSessionRow, ChosungGameRoundRow } from "./gameSessionManager";
import { createEmptyUtteranceSignals as emptySignals } from "../play/playSelection";

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

test("2. 실측 '농구' 정답 제출: 맞혔다는 instruction과 결정론 응답 뒤 다음 초성 포함", async () => {
  const initialSession: ChosungGameSessionRow = {
    id: "sess-active-1",
    child_id: "child-2",
    chat_session_id: "chat-2",
    state: "PLAYING_CHILD_ASKS",
    initiated_by: "CHILD",
    current_word: "농구",
    current_chosung: "ㄴㄱ",
    current_category: "운동",
    current_difficulty: 1,
    hint_level: 0,
    recent_words: ["농구"],
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
    utterance: "농구",
    signals: {
      hasChosungGameStart: false,
      hasChosungAnswerAttempt: true,
      hasChosungHintRequest: false,
    },
  };

  const result = await runChosungTurn(input);
  assert.equal(result.handled, true);
  assert.ok(result.instruction);
  assert.match(result.instruction!, /아이가 정답 "농구"를 맞혔어/);
  assert.match(result.instruction!, /다음 문제 초성 ".*"를 내줘/);
  assert.match(result.instruction!, /정답 단어는 절대 말하지 마/);
  assert.match(result.deterministicText!, /맞았어!/);
  assert.match(result.deterministicText!, /농구/);
  assert.match(result.deterministicText!, /다음 문제 초성/);
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
  // 오답 시 모델 지시문에 정답이 [정답]: 사과 형태로 제공되고, 유출 방지 필드가 설정됨
  assert.ok(result.instruction!.includes(`[정답]: ${secretWord}`));
  assert.equal(result.answerMustNotAppear, secretWord);
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
  assert.ok(result.instruction!.includes(`[정답]: ${secretWord}`));
  assert.equal(result.answerMustNotAppear, secretWord);
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

const makeSession = (over: Partial<ChosungGameSessionRow> = {}): ChosungGameSessionRow => ({
  id: "sess-reveal",
  child_id: "child-r",
  chat_session_id: "chat-r",
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
  ...over,
});

const answerTurn = (db: SupabaseClient, over: Partial<ChosungTurnInput> = {}): ChosungTurnInput => ({
  db,
  childId: "child-r",
  chatSessionId: "chat-r",
  gradeRaw: 1,
  utterance: "수박?",
  signals: { hasChosungGameStart: false, hasChosungAnswerAttempt: true, hasChosungHintRequest: false },
  ...over,
});

test("7. 오답이 누적되면 정답을 알려주고 다음 문제로 넘어간다", async () => {
  // 답을 끝까지 감추면 아이는 답답하기만 하고 배우는 것도 없다(§19 힌트 4단계 = 정답 공개).
  const db = createMockSupabase({
    sessions: [makeSession({ hint_level: CHOSUNG_MAX_WRONG_BEFORE_REVEAL - 1 })],
  });
  const result = await runChosungTurn(answerTurn(db));

  assert.equal(result.handled, true);
  assert.match(String(result.instruction), /사과/, "정답을 알려줘야 한다");
  assert.match(String(result.instruction), /다음 문제/, "다음 문제로 넘어가야 한다");
});

test("8. 오답이 아직 적으면 지시문에 [정답]을 명시하여 올바른 힌트를 유도한다", async () => {
  const db = createMockSupabase({ sessions: [makeSession({ hint_level: 0 })] });
  const result = await runChosungTurn(answerTurn(db));

  assert.equal(result.handled, true);
  assert.ok(String(result.instruction).includes("[정답]: 사과"), "모델에게 정답을 주어 올바른 힌트를 유도해야 한다");
  assert.equal(result.answerMustNotAppear, "사과");
  assert.match(String(result.instruction), /힌트/);
});

test("9. 힌트를 끝까지 요청하면 정답을 알려준다", async () => {
  const db = createMockSupabase({
    sessions: [makeSession({ hint_level: CHOSUNG_REVEAL_HINT_LEVEL - 1 })],
  });
  const result = await runChosungTurn(answerTurn(db, {
    utterance: "모르겠어",
    signals: { hasChosungGameStart: false, hasChosungAnswerAttempt: false, hasChosungHintRequest: true },
  }));

  assert.equal(result.handled, true);
  assert.match(String(result.instruction), /사과/, "힌트 마지막 단계는 정답 공개다");
  assert.ok(result.requiredChosungInOutput, "다음 문제 초성이 requiredChosungInOutput에 있어야 한다");
});

test("10. '답이 뭐야' 같은 정답 요구 신호는 hint_level과 무관하게 즉시 정답을 공개한다 (2026-08-18 사고 수정)", async () => {
  const db = createMockSupabase({
    sessions: [makeSession({ hint_level: 0 })],
  });
  const result = await runChosungTurn(answerTurn(db, {
    utterance: "답이 뭐야?",
    signals: {
      hasChosungGameStart: false,
      hasChosungAnswerAttempt: false,
      hasChosungHintRequest: false,
      hasChosungAnswerRequest: true,
    },
  }));

  assert.equal(result.handled, true);
  assert.match(String(result.instruction), /사과/, "정답 요구 시 즉시 정답을 공개해야 한다");
  assert.match(String(result.instruction), /다음 문제 초성/, "다음 문제를 내야 한다");
  assert.ok(result.requiredChosungInOutput, "새 문제의 초성이 requiredChosungInOutput에 담겨야 한다");
});


test("힌트·오답 턴은 초성 반복을 강제하지 않는다 — 진짜 힌트가 대체 문구로 날아가면 안 된다", async () => {
  // 2026-08-18 Dev QA 실측: 아이가 "힌트 좀 알려줘" 했는데 케이가
  // "자, 다시 낼게! 초성은 'ㅃㄹㄹ' 이야. 뭘까?" 만 반복했다. 힌트 턴에까지
  // requiredChosungInOutput 을 걸어, 초성 문자열을 다시 말하지 않은 정상 힌트
  // ("미술 시간에 쓰는 거야")가 통째로 대체 문구로 바뀐 탓이다.
  // 이 턴들은 문제를 내는 턴이 아니다. 방어는 정답 유출로 충분하다.
  const session = {
    id: "s-guard", child_id: "child-g", chat_session_id: "chat-g",
    state: "PLAYING_CHILD_ASKS", current_word: "사과", current_chosung: "ㅅㄱ",
    current_category: "음식", current_difficulty: 1, hint_level: 0,
    recent_words: ["사과"], started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(), ended_at: null,
  };

  const hint = await runChosungTurn({
    db: createMockSupabase({ sessions: [session] }) as never,
    childId: "child-g", chatSessionId: "chat-g", gradeRaw: 1,
    utterance: "힌트 줘",
    signals: { ...emptySignals(), hasChosungHintRequest: true },
  } as never);
  assert.equal(hint.handled, true);
  assert.equal(hint.requiredChosungInOutput, undefined, "힌트 턴은 초성 강제 대상이 아니다");
  assert.equal(hint.answerMustNotAppear, "사과", "정답 유출 방어는 그대로 있어야 한다");

  const wrong = await runChosungTurn({
    db: createMockSupabase({ sessions: [session] }) as never,
    childId: "child-g", chatSessionId: "chat-g", gradeRaw: 1,
    utterance: "바나나",
    signals: { ...emptySignals(), hasChosungAnswerAttempt: true },
  } as never);
  assert.equal(wrong.requiredChosungInOutput, undefined, "오답 턴도 초성 강제 대상이 아니다");
  assert.equal(wrong.answerMustNotAppear, "사과");
});
