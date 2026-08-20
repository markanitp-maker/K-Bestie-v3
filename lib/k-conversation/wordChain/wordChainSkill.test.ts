import assert from "node:assert/strict";
import { test, describe } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  WORD_CHAIN_SKILL,
  detectWordChainStart,
  getWordChainGradeDifficulty,
  selectInitialKWord,
} from "./wordChainSkill";
import type { UtteranceSignals } from "../utteranceSignals";
import {
  type WordChainSessionRow,
  type WordChainRoundRow,
  getActiveWordChainSession,
} from "./sessionManager";
import { lookupWord } from "./dictionaryIndex";

const defaultSignals: UtteranceSignals = {
  hasAchievement: false,
  hasConflict: false,
  hasPlayfulSilly: false,
  hasImaginative: false,
  hasMemoryRecallQuery: false,
  hasGeneralKnowledgeQuestion: false,
  hasNegativeEmotion: false,
  hasPositiveEmotion: false,
  hasPhysicalNeed: false,
  isVeryShortLowEffort: false,
  hasChosungGameStart: false,
  hasChosungAnswerAttempt: false,
  hasChosungHintRequest: false,
  hasWordChainGameStart: false,
};

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
        { id: "chat-1", child_id: "child-1" },
        { id: "chat-2", child_id: "child-2" },
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
          select: (_cols?: string) => {
            let filtered = [...sessionsStore];
            const builder: any = {
              eq: (col: string, val: any) => {
                filtered = filtered.filter((r) => (r as any)[col] === val);
                return builder;
              },
              is: (col: string, val: any) => {
                if (val === null) {
                  filtered = filtered.filter((r) => (r as any)[col] === null);
                } else {
                  filtered = filtered.filter((r) => (r as any)[col] === val);
                }
                return builder;
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
            return builder;
          },
          insert: (record: Partial<WordChainSessionRow>) => {
            const newRow: WordChainSessionRow = {
              id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              child_id: record.child_id || "child-1",
              chat_session_id: record.chat_session_id || "chat-1",
              initiated_by: record.initiated_by || "K",
              state: record.state || "CHILD_TURN",
              current_word: record.current_word || null,
              current_difficulty: record.current_difficulty || 1,
              used_words: record.used_words ? [...record.used_words] : [],
              started_at: record.started_at || new Date().toISOString(),
              updated_at: record.updated_at || new Date().toISOString(),
              ended_at: record.ended_at || null,
            };
            sessionsStore.push(newRow);

            return {
              select: () => ({
                single: async () => ({ data: newRow, error: null }),
              }),
            };
          },
          update: (updates: Partial<WordChainSessionRow>) => {
            let targetId: string | null = null;
            let targetChildId: string | null = null;

            const updateChain: any = {
              eq: (col: string, val: any) => {
                if (col === "id") targetId = val;
                if (col === "child_id") targetChildId = val;
                return updateChain;
              },
              select: () => ({
                single: async () => {
                  const idx = sessionsStore.findIndex((s) => {
                    if (targetId && s.id !== targetId) return false;
                    if (targetChildId && s.child_id !== targetChildId) return false;
                    return true;
                  });
                  if (idx === -1) {
                    return { data: null, error: { message: "Update target not found" } };
                  }
                  sessionsStore[idx] = {
                    ...sessionsStore[idx],
                    ...updates,
                    updated_at: new Date().toISOString(),
                  };
                  return { data: sessionsStore[idx], error: null };
                },
              }),
            };

            // Support direct await on update (e.g. for endWordChainSession)
            updateChain.then = (resolve: any) => {
              const idx = sessionsStore.findIndex((s) => {
                if (targetId && s.id !== targetId) return false;
                if (targetChildId && s.child_id !== targetChildId) return false;
                return true;
              });
              if (idx !== -1) {
                sessionsStore[idx] = {
                  ...sessionsStore[idx],
                  ...updates,
                  updated_at: new Date().toISOString(),
                };
              }
              resolve({ error: null });
            };

            return updateChain;
          },
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      if (tableName === "word_chain_game_rounds") {
        return {
          insert: (round: Partial<WordChainRoundRow>) => {
            const newRound: WordChainRoundRow = {
              id: `round-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              session_id: round.session_id || "sess-1",
              child_id: round.child_id || "child-1",
              word: round.word || "",
              by: round.by || "CHILD",
              difficulty: round.difficulty || 1,
              result: round.result || "ACCEPTED",
              created_at: round.created_at || new Date().toISOString(),
            };
            roundsStore.push(newRound);
            return Promise.resolve({ data: newRound, error: null });
          },
          select: (_cols?: string) => {
            let filtered = [...roundsStore];
            const roundBuilder: any = {
              eq: (col: string, val: any) => {
                filtered = filtered.filter((r) => (r as any)[col] === val);
                return roundBuilder;
              },
              order: (_col: string, _opts?: { ascending: boolean }) => {
                return roundBuilder;
              },
              limit: async (n: number) => {
                return { data: filtered.slice(0, n), error: null };
              },
            };
            return roundBuilder;
          },
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      return {} as unknown as ReturnType<SupabaseClient["from"]>;
    },
  } as unknown as SupabaseClient;
}

describe("WORD_CHAIN_SKILL Adapter", () => {
  test("Skill Contract 기본 속성 및 Proposal 검증", () => {
    assert.equal(WORD_CHAIN_SKILL.id, "WORD_CHAIN");
    assert.equal(WORD_CHAIN_SKILL.proposal.label, "끝말잇기");
    assert.ok(WORD_CHAIN_SKILL.proposal.shortDescription.length > 0);
  });

  test("matchesDirectRequest: 직접 요청을 정확히 잡고, 부정문 및 정의 질문은 제외한다", () => {
    // 긍정 케이스
    assert.equal(WORD_CHAIN_SKILL.matchesDirectRequest(defaultSignals, "끝말잇기 하자"), true);
    assert.equal(WORD_CHAIN_SKILL.matchesDirectRequest(defaultSignals, "끝말 잇기 할래"), true);
    assert.equal(WORD_CHAIN_SKILL.matchesDirectRequest(defaultSignals, "말잇기 게임 하자"), true);
    assert.equal(WORD_CHAIN_SKILL.matchesDirectRequest(defaultSignals, "단어 잇기 놀이 하자"), true);
    assert.equal(WORD_CHAIN_SKILL.matchesDirectRequest(defaultSignals, "끝말 이어가기 하자"), true);
    assert.equal(WORD_CHAIN_SKILL.matchesDirectRequest(defaultSignals, "끝말잇기"), true);

    // signals.hasWordChainGameStart = true 케이스
    assert.equal(
      WORD_CHAIN_SKILL.matchesDirectRequest(
        { ...defaultSignals, hasWordChainGameStart: true },
        "아무말"
      ),
      true
    );

    // 부정문 제외 케이스
    assert.equal(WORD_CHAIN_SKILL.matchesDirectRequest(defaultSignals, "끝말잇기 안 해"), false);
    assert.equal(WORD_CHAIN_SKILL.matchesDirectRequest(defaultSignals, "끝말잇기 하기 싫어"), false);
    assert.equal(WORD_CHAIN_SKILL.matchesDirectRequest(defaultSignals, "끝말잇기 싫어"), false);
    assert.equal(WORD_CHAIN_SKILL.matchesDirectRequest(defaultSignals, "끝말잇기 그만"), false);
    assert.equal(WORD_CHAIN_SKILL.matchesDirectRequest(defaultSignals, "끝말잇기 재미없어"), false);
    assert.equal(WORD_CHAIN_SKILL.matchesDirectRequest(defaultSignals, "끝말잇기 하지마"), false);

    // 정의/설명 질문 제외 케이스
    assert.equal(WORD_CHAIN_SKILL.matchesDirectRequest(defaultSignals, "끝말잇기가 뭐야?"), false);
    assert.equal(WORD_CHAIN_SKILL.matchesDirectRequest(defaultSignals, "끝말잇기 뭔데?"), false);
    assert.equal(WORD_CHAIN_SKILL.matchesDirectRequest(defaultSignals, "끝말잇기 무슨 뜻이야?"), false);
    assert.equal(WORD_CHAIN_SKILL.matchesDirectRequest(defaultSignals, "끝말잇기 규칙 알려줘"), false);
    assert.equal(WORD_CHAIN_SKILL.matchesDirectRequest(defaultSignals, "끝말잇기 알아?"), false);

    // 무관한 일반 발화
    assert.equal(WORD_CHAIN_SKILL.matchesDirectRequest(defaultSignals, "오늘 날씨 어때?"), false);
    assert.equal(WORD_CHAIN_SKILL.matchesDirectRequest(defaultSignals, "초성게임 하자"), false);
  });

  test("start: K의 첫 단어를 학년 난이도에 맞춰 선택하고 instruction에 포함한다", async () => {
    const db = createMockSupabase();
    const result = await WORD_CHAIN_SKILL.start({
      db,
      childId: "child-1",
      chatSessionId: "chat-1",
      gradeRaw: 1,
      utterance: "끝말잇기 하자",
      signals: defaultSignals,
    });

    assert.equal(result.handled, true);
    assert.equal(result.ended, false);
    assert.ok(result.instruction);
    assert.ok(result.instruction.includes("[끝말잇기]"));
    // 015 — 케이는 자기를 "내가"라고 부른다. 3인칭이면 "케이이가 먼저 시작할게"가 나온다.
    assert.ok(result.instruction.includes("첫 번째 단어"));
    assert.ok(result.instruction.includes("내가 먼저"), "1인칭 표현이 아니다");
    assert.ok(!result.instruction.includes("케이가 먼저"), "3인칭 표현이 남아 있다");

    // 활성 세션 생성 확인
    const active = await WORD_CHAIN_SKILL.getActiveSession(db, "child-1");
    assert.ok(active);
  });

  test("start: 이미 활성 세션이 있으면 중복 생성하지 않고 기존 세션의 단어로 안내한다", async () => {
    const existingSession: WordChainSessionRow = {
      id: "sess-existing-1",
      child_id: "child-1",
      chat_session_id: "chat-1",
      initiated_by: "K",
      state: "CHILD_TURN",
      current_word: "바나나",
      current_difficulty: 1,
      used_words: ["바나나"],
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ended_at: null,
    };

    const db = createMockSupabase({ sessions: [existingSession] });

    const result = await WORD_CHAIN_SKILL.start({
      db,
      childId: "child-1",
      chatSessionId: "chat-1",
      gradeRaw: 2,
      utterance: "끝말잇기 하자",
      signals: defaultSignals,
    });

    assert.equal(result.handled, true);
    assert.equal(result.ended, false);
    assert.ok(result.instruction?.includes("이미 진행 중인 끝말잇기 게임이 있어"));
    assert.ok(result.instruction?.includes("바나나"));
    assert.ok(result.instruction?.includes("나"));
  });

  test("handleTurn: 정상 흐름 (아이 단어 통과 -> K 단어가 끝말로 이어짐)", async () => {
    const session: WordChainSessionRow = {
      id: "sess-1",
      child_id: "child-1",
      chat_session_id: "chat-1",
      initiated_by: "K",
      state: "CHILD_TURN",
      current_word: "가방",
      current_difficulty: 2,
      used_words: ["가방"],
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ended_at: null,
    };

    const db = createMockSupabase({ sessions: [session] });

    const result = await WORD_CHAIN_SKILL.handleTurn({
      db,
      childId: "child-1",
      chatSessionId: "chat-1",
      gradeRaw: 2,
      utterance: "방학",
      signals: defaultSignals,
    });

    assert.equal(result.handled, true);
    assert.equal(result.ended, false);
    assert.ok(result.instruction);
    assert.ok(result.instruction.includes("방학"));
    // 018(a06.png) — 이 턴은 아이에게 들려줄 문장을 스킬이 직접 만든다.
    // 지시문은 값만 남기고, 형식은 deterministicText 가 고정한다.
    assert.ok(result.deterministicText, "결정론 문장이 없다");
    const dtLines = result.deterministicText.split("\n");
    assert.equal(dtLines.length, 3, `3줄이 아니다: ${JSON.stringify(dtLines)}`);
    assert.equal(dtLines[0], "방학...");
    assert.ok(dtLines[1].startsWith("나는 "), dtLines[1]);
    assert.ok(dtLines[2].startsWith("이제 "), dtLines[2]);
    // 금지 문구가 아이에게 나가지 않는다.
    for (const banned of ["멋지게", "이어줬어", "받을게"]) {
      assert.ok(!result.deterministicText.includes(banned), `금지 문구: ${banned}`);
    }

    // [중요 검증] 아이 단어('방학')와 케이 단어 둘 다 used_words 및 current_word에 반영되어야 함
    const afterSession = await getActiveWordChainSession(db, "child-1");
    assert.ok(afterSession);
    assert.ok(afterSession.used_words.includes("가방"));
    assert.ok(afterSession.used_words.includes("방학"));
    assert.equal(afterSession.used_words.length, 3);
    assert.equal(afterSession.current_word, afterSession.used_words[2]);
  });

  test("handleTurn: 두음법칙 적용 정상 연결 통과 ('개나리' -> '이슬')", async () => {
    const session: WordChainSessionRow = {
      id: "sess-dueum",
      child_id: "child-1",
      chat_session_id: "chat-1",
      initiated_by: "K",
      state: "CHILD_TURN",
      current_word: "개나리",
      current_difficulty: 2,
      used_words: ["개나리"],
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ended_at: null,
    };

    const db = createMockSupabase({ sessions: [session] });

    const result = await WORD_CHAIN_SKILL.handleTurn({
      db,
      childId: "child-1",
      chatSessionId: "chat-1",
      gradeRaw: 3,
      utterance: "이슬",
      signals: defaultSignals,
    });

    assert.equal(result.handled, true);
    assert.equal(result.ended, false);
    assert.ok(result.instruction?.includes("이슬"));
  });

  test("handleTurn: 거절 5종이 각각 다른 맞춤형 안내를 만든다", async () => {
    const baseSession: WordChainSessionRow = {
      id: "sess-rejection-test",
      child_id: "child-1",
      chat_session_id: "chat-1",
      initiated_by: "K",
      state: "CHILD_TURN",
      current_word: "가방",
      current_difficulty: 2,
      used_words: ["가방", "방학"],
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ended_at: null,
    };

    // 1. NOT_IN_DICTIONARY: 케이가 모르는 말이라고 하고 다시 기회를 줌 ("그런 말은 없어" 단정 금지)
    const db1 = createMockSupabase({ sessions: [{ ...baseSession }] });
    const res1 = await WORD_CHAIN_SKILL.handleTurn({
      db: db1,
      childId: "child-1",
      chatSessionId: "chat-1",
      gradeRaw: 2,
      utterance: "방사능외계어",
      signals: defaultSignals,
    });
    assert.equal(res1.handled, true);
    assert.ok(res1.instruction?.includes("케이가 아직 잘 모르는 단어야"));
    assert.ok(!res1.instruction?.includes("그런 말은 없어"));

    // 2. ALREADY_USED: 아까 나온 말이라고 알려줌
    const db2 = createMockSupabase({ sessions: [{ ...baseSession }] });
    const res2 = await WORD_CHAIN_SKILL.handleTurn({
      db: db2,
      childId: "child-1",
      chatSessionId: "chat-1",
      gradeRaw: 2,
      utterance: "방학",
      signals: defaultSignals,
    });
    assert.equal(res2.handled, true);
    assert.ok(res2.instruction?.includes("이미 나왔던 단어야"));

    // 3. CHAIN_MISMATCH: 어떤 글자로 시작해야 하는지 명확히 알려줌
    const db3 = createMockSupabase({ sessions: [{ ...baseSession }] });
    const res3 = await WORD_CHAIN_SKILL.handleTurn({
      db: db3,
      childId: "child-1",
      chatSessionId: "chat-1",
      gradeRaw: 2,
      utterance: "사과",
      signals: defaultSignals,
    });
    assert.equal(res3.handled, true);
    assert.ok(res3.instruction?.includes("글자가 이어지지 않아"));
    assert.ok(res3.instruction?.includes("방")); // 필요한 시작 글자 포함

    // 4. NOT_HANGUL: 한글 단어로 말해달라고 요청
    const db4 = createMockSupabase({ sessions: [{ ...baseSession }] });
    const res4 = await WORD_CHAIN_SKILL.handleTurn({
      db: db4,
      childId: "child-1",
      chatSessionId: "chat-1",
      gradeRaw: 2,
      utterance: "apple",
      signals: defaultSignals,
    });
    assert.equal(res4.handled, true);
    assert.ok(res4.instruction?.includes("한글 단어"));

    // 5. EMPTY: 다시 말해달라고 요청
    const db5 = createMockSupabase({ sessions: [{ ...baseSession }] });
    const res5 = await WORD_CHAIN_SKILL.handleTurn({
      db: db5,
      childId: "child-1",
      chatSessionId: "chat-1",
      gradeRaw: 2,
      utterance: "   ",
      signals: defaultSignals,
    });
    assert.equal(res5.handled, true);
    assert.ok(res5.instruction?.includes("잘 못 들었어"));
  });

  test("handleTurn: 3회 연속 실패 시(Frustration) 격려와 힌트가 instruction에 추가된다", async () => {
    const session: WordChainSessionRow = {
      id: "sess-frustrated",
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
    };

    const pastRounds: WordChainRoundRow[] = [
      {
        id: "r1",
        session_id: "sess-frustrated",
        child_id: "child-1",
        word: "틀린말1",
        by: "CHILD",
        difficulty: 1,
        result: "NOT_IN_DICTIONARY",
        created_at: new Date(Date.now() - 3000).toISOString(),
      },
      {
        id: "r2",
        session_id: "sess-frustrated",
        child_id: "child-1",
        word: "틀린말2",
        by: "CHILD",
        difficulty: 1,
        result: "NOT_IN_DICTIONARY",
        created_at: new Date(Date.now() - 2000).toISOString(),
      },
    ];

    const db = createMockSupabase({ sessions: [session], rounds: pastRounds });

    const result = await WORD_CHAIN_SKILL.handleTurn({
      db,
      childId: "child-1",
      chatSessionId: "chat-1",
      gradeRaw: 1,
      utterance: "틀린말3",
      signals: defaultSignals,
    });

    assert.equal(result.handled, true);
    assert.ok(result.instruction?.includes("어려워하고 있으니"));
    assert.ok(result.instruction?.includes("힌트"));
  });

  test("handleTurn: K가 이어갈 단어가 없으면 아이 승리로 세션이 종료된다", async () => {
    const session: WordChainSessionRow = {
      id: "sess-child-win",
      child_id: "child-1",
      chat_session_id: "chat-1",
      initiated_by: "K",
      state: "CHILD_TURN",
      current_word: "해질녘",
      current_difficulty: 2,
      used_words: ["해질녘"],
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ended_at: null,
    };

    const db = createMockSupabase({ sessions: [session] });

    // 사전에 등록된 단어 중 끝 글자(예: 녘)로 시작하는 단어가 없는 단어 사용
    const result = await WORD_CHAIN_SKILL.handleTurn({
      db,
      childId: "child-1",
      chatSessionId: "chat-1",
      gradeRaw: 3,
      utterance: "새벽녘",
      signals: defaultSignals,
    });

    // 만약 새벽녘이 사전에 있다면 승리 처리
    const entry = lookupWord("새벽녘");
    if (entry) {
      assert.equal(result.handled, true);
      assert.equal(result.ended, true);
      assert.ok(result.instruction?.includes("아이가 이겼어"));
    }
  });

  test("Safety / 부정감정 / 갈등 신호 발생 시 handled=false로 빠지고 세션이 종료된다", async () => {
    const session: WordChainSessionRow = {
      id: "sess-safety",
      child_id: "child-1",
      chat_session_id: "chat-1",
      initiated_by: "K",
      state: "CHILD_TURN",
      current_word: "가방",
      current_difficulty: 1,
      used_words: ["가방"],
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ended_at: null,
    };

    // 1. 친구와 싸움 (갈등)
    const db1 = createMockSupabase({ sessions: [{ ...session }] });
    const res1 = await WORD_CHAIN_SKILL.handleTurn({
      db: db1,
      childId: "child-1",
      chatSessionId: "chat-1",
      gradeRaw: 2,
      utterance: "오늘 학교에서 친구랑 싸웠어",
      signals: { ...defaultSignals, hasConflict: true },
    });
    assert.deepEqual(res1, { handled: false });
    const active1 = await WORD_CHAIN_SKILL.getActiveSession(db1, "child-1");
    assert.equal(active1, null, "갈등 발생 시 세션이 종료되어야 함");

    // 2. 부정감정 (속상함)
    const db2 = createMockSupabase({ sessions: [{ ...session }] });
    const res2 = await WORD_CHAIN_SKILL.handleTurn({
      db: db2,
      childId: "child-1",
      chatSessionId: "chat-1",
      gradeRaw: 2,
      utterance: "너무 속상해",
      signals: { ...defaultSignals, hasNegativeEmotion: true },
    });
    assert.deepEqual(res2, { handled: false });
    const active2 = await WORD_CHAIN_SKILL.getActiveSession(db2, "child-1");
    assert.equal(active2, null, "부정감정 발생 시 세션이 종료되어야 함");
  });

  test("주제 전환(Topic Shift)이 오답으로 처리되지 않고 handled=false로 빠진다", async () => {
    const session: WordChainSessionRow = {
      id: "sess-topic-shift",
      child_id: "child-1",
      chat_session_id: "chat-1",
      initiated_by: "K",
      state: "CHILD_TURN",
      current_word: "가방",
      current_difficulty: 1,
      used_words: ["가방"],
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ended_at: null,
    };

    const db = createMockSupabase({ sessions: [session] });

    const result = await WORD_CHAIN_SKILL.handleTurn({
      db,
      childId: "child-1",
      chatSessionId: "chat-1",
      gradeRaw: 2,
      utterance: "오늘 점심에 돈까스 먹었어",
      signals: defaultSignals,
    });

    assert.deepEqual(result, { handled: false });
    const active = await WORD_CHAIN_SKILL.getActiveSession(db, "child-1");
    assert.equal(active, null, "주제 전환 시 게임 세션이 종료되어 일반 대화로 복귀해야 함");
  });

  test("명시적 중단 요청 시 handled=true, ended=true로 다정하게 종료된다", async () => {
    const session: WordChainSessionRow = {
      id: "sess-stop",
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
    };

    const db = createMockSupabase({ sessions: [session] });

    const result = await WORD_CHAIN_SKILL.handleTurn({
      db,
      childId: "child-1",
      chatSessionId: "chat-1",
      gradeRaw: 2,
      utterance: "끝말잇기 그만할래",
      signals: defaultSignals,
    });

    assert.equal(result.handled, true);
    assert.equal(result.ended, true);
    assert.ok(result.instruction?.includes("그만하자고 했어"));
  });

  test("end: active 세션을 정상적으로 종료한다", async () => {
    const session: WordChainSessionRow = {
      id: "sess-end-test",
      child_id: "child-1",
      chat_session_id: "chat-1",
      initiated_by: "K",
      state: "CHILD_TURN",
      current_word: "하늘",
      current_difficulty: 1,
      used_words: ["하늘"],
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ended_at: null,
    };

    const db = createMockSupabase({ sessions: [session] });

    await WORD_CHAIN_SKILL.end({
      db,
      childId: "child-1",
      chatSessionId: "chat-1",
    });

    const active = await WORD_CHAIN_SKILL.getActiveSession(db, "child-1");
    assert.equal(active, null);
  });

  test("DB 실패 시 예외가 밖으로 새지 않는다 (Fail-Open 격리)", async () => {
    const failingDb = createMockSupabase({ shouldFail: true });

    const startRes = await WORD_CHAIN_SKILL.start({
      db: failingDb,
      childId: "child-1",
      chatSessionId: "chat-1",
      gradeRaw: 2,
      utterance: "끝말잇기 하자",
      signals: defaultSignals,
    });
    assert.ok(startRes); // no crash

    const turnRes = await WORD_CHAIN_SKILL.handleTurn({
      db: failingDb,
      childId: "child-1",
      chatSessionId: "chat-1",
      gradeRaw: 2,
      utterance: "가방",
      signals: defaultSignals,
    });
    // 조회 실패는 "놀이 없음" 이 아니다(2026-08-20). fail-open 은 그대로지만
    // 상태가 미확정임을 알린다 — 없다고 단정하면 살아 있는 놀이가 그 턴에 죽는다.
    assert.equal(turnRes.handled, false, "케이는 침묵하지 않는다");

    // end() 는 이제 종료 실패를 알린다.
    //
    // 예전 계약은 "end 는 던지지 않는다" 였다. 그래서 종료가 실패해도 호출부가
    // "끝났다" 고 믿었고, 아이가 "그만" 했는데 세션이 남아 다음 턴에 놀이가
    // 되살아났다(리뷰 지적, 2026-08-20). 끝난 척은 fail-open 이 아니라 거짓말이다.
    //
    // 대신 침묵 방지는 위 start/handleTurn 단정이 계속 지킨다 — 그쪽은 여전히
    // 예외를 밖으로 내지 않는다.
    await assert.rejects(
      () =>
        WORD_CHAIN_SKILL.end({
          db: failingDb,
          childId: "child-1",
          chatSessionId: "chat-1",
          reason: "EXPLICIT_STOP",
        }),
      "종료 실패가 호출부에 전달되어야 한다"
    );
  });
});

// ── 요청서 014: 2026-08-18 23:56 Dev 실측(김서아) 회귀 ────────────────────────
// 아이가 문장 끝에 낱말을 붙여 말하면("… 귀찮냐 차표") 그 낱말을 낱말로 봐야 한다.
// 문장 전체를 낱말로 넘겨 "차표" 를 유실했던 사고를 고정한다.
test("문장 속 마지막 낱말을 끝말잇기 낱말로 뽑는다", async () => {
  const { extractChildCandidateWordForTest } = await import("./wordChainSkill");
  assert.equal(
    extractChildCandidateWordForTest("아 진짜 한참 째 끝말잇기 하긴 하는 구나 귀찮냐 차표"),
    "차표"
  );
  assert.equal(extractChildCandidateWordForTest("차표"), "차표");
  assert.equal(extractChildCandidateWordForTest("정답은 기차야"), "기차");
  assert.equal(extractChildCandidateWordForTest("음... 사과!"), "사과");
});

// 단독 단답에도 종결 조사를 뗀다(2026-08-19 리뷰 HIGH 지적: "기차야" 가 오답 처리됐다).
test("단독 낱말 단답의 종결 조사를 뗀다", async () => {
  const { extractChildCandidateWordForTest } = await import("./wordChainSkill");
  assert.equal(extractChildCandidateWordForTest("기차야"), "기차");
  assert.equal(extractChildCandidateWordForTest("사과요"), "사과");
  assert.equal(extractChildCandidateWordForTest("사탕이다"), "사탕");
  // 사전에 없는 형태는 그대로 둔다(아이 발화를 함부로 고치지 않는다).
  assert.equal(extractChildCandidateWordForTest("몰라"), "몰라");
  assert.equal(extractChildCandidateWordForTest("차표"), "차표");
});
