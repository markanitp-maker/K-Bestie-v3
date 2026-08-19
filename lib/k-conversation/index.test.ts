import assert from "node:assert/strict";
import { test } from "node:test";

import { filterRecentHistory, respond, checkSafetyPreflight } from "./index";
import type { SessionTurn } from "./memory/sameSession";

test("MISSION 첫 턴: currentUtteranceAlreadyInSession=true 일 때 sameSession의 유일한 아이 턴 제거", () => {
  const sameSession: SessionTurn[] = [{ role: "child", content: "안녕하세요" }];
  const currentUtterance = "안녕하세요";

  const history = filterRecentHistory(sameSession, currentUtterance, true);

  assert.deepEqual(history, []);
});

test("MISSION 중간 턴: currentUtteranceAlreadyInSession=true 일 때 이전 이력은 유지되고 마지막 현재 발화 턴만 제거", () => {
  const sameSession: SessionTurn[] = [
    { role: "child", content: "오늘 학교 갔다 왔어" },
    { role: "k", content: "학교에서 뭐 했어?" },
    { role: "child", content: "축구했어" },
  ];
  const currentUtterance = "축구했어";

  const history = filterRecentHistory(sameSession, currentUtterance, true);

  assert.deepEqual(history, [
    { role: "child", text: "오늘 학교 갔다 왔어" },
    { role: "k", text: "학교에서 뭐 했어?" },
  ]);
});

test("아이의 연속 동일 발화: currentUtteranceAlreadyInSession=true 일 때 마지막 1건만 제거되어 앞선 동일 발화 보존", () => {
  const sameSession: SessionTurn[] = [
    { role: "child", content: "안녕" },
    { role: "k", content: "안녕! 또 만났네" },
    { role: "child", content: "안녕" },
  ];
  const currentUtterance = "안녕";

  const history = filterRecentHistory(sameSession, currentUtterance, true);

  assert.deepEqual(history, [
    { role: "child", text: "안녕" },
    { role: "k", text: "안녕! 또 만났네" },
  ]);
});

test("FREE_CHAT 모드: currentUtteranceAlreadyInSession=false/undefined 일 때 sameSession 변형 없이 그대로 반환", () => {
  const sameSession: SessionTurn[] = [
    { role: "child", content: "안녕" },
    { role: "k", content: "안녕!" },
  ];

  const historyFalse = filterRecentHistory(sameSession, "오늘 날씨 좋다", false);
  assert.deepEqual(historyFalse, [
    { role: "child", text: "안녕" },
    { role: "k", text: "안녕!" },
  ]);

  const historyUndefined = filterRecentHistory(sameSession, "오늘 날씨 좋다", undefined);
  assert.deepEqual(historyUndefined, [
    { role: "child", text: "안녕" },
    { role: "k", text: "안녕!" },
  ]);
});

test("공백 및 포맷 차이: normalizeSameSessionText 정규화를 거쳐 정확히 대조 후 1건 제거", () => {
  // 정규화 대상은 "공백 개수 차이"뿐이다 — 문장 자체는 같아야 한다.
  const sameSession: SessionTurn[] = [{ role: "child", content: "안녕  하세요" }];
  const currentUtterance = "안녕 하세요";

  const history = filterRecentHistory(sameSession, currentUtterance, true);

  assert.deepEqual(history, []);
});

test("마지막 턴이 K 응답이거나 텍스트 불일치 시 제거하지 않음", () => {
  const sameSessionKLast: SessionTurn[] = [
    { role: "child", content: "안녕" },
    { role: "k", content: "응 무슨 일이야?" },
  ];
  const historyKLast = filterRecentHistory(sameSessionKLast, "응 무슨 일이야?", true);
  assert.equal(historyKLast.length, 2);

  const sameSessionDiffText: SessionTurn[] = [{ role: "child", content: "이전 발화" }];
  const historyDiff = filterRecentHistory(sameSessionDiffText, "새 발화", true);
  assert.equal(historyDiff.length, 1);
});

// --- K Conversation Engine & Play Platform Integration Tests ---

import type { SupabaseClient } from "@supabase/supabase-js";
import { respond } from "./index";

function createMockDbForRespond(options: {
  activeChosungSession?: { id: string; current_word?: string; current_chosung?: string } | null;
  activeWordChainSession?: { id: string; current_word?: string; used_words?: string[] } | null;
  activeNonsenseSession?: { id: string; current_question_id?: string; hint_level?: number } | null;
  throwOnActiveSession?: boolean;
  onUpdate?: (table: string, data: any) => void;
} = {}): SupabaseClient {
  const getChosungSessionData = () => options.activeChosungSession ?? null;
  const getWordChainSessionData = () => {
    if (!options.activeWordChainSession) return null;
    return {
      id: "wc-session-1",
      child_id: "child-1",
      chat_session_id: "session-1",
      state: "CHILD_TURN",
      initiated_by: "K",
      current_word: "사과",
      current_difficulty: 1,
      used_words: ["사과"],
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ended_at: null,
      ...options.activeWordChainSession,
    };
  };
  const getNonsenseSessionData = () => options.activeNonsenseSession ?? null;

  const createTableChain = (table: string) => {
    const tableChain: any = {
      select: () => tableChain,
      eq: () => tableChain,
      is: () => tableChain,
      order: () => tableChain,
      limit: () => tableChain,
      single: async () => {
        if (table === "chosung_game_sessions") {
          return {
            data: options.activeChosungSession ?? {
              id: "cs-session-1",
              child_id: "child-1",
              chat_session_id: "session-1",
              state: "PLAYING_K_ASKS",
              initiated_by: "CHILD",
              current_word: "바나나",
              current_chosung: "ㅂㄴㄴ",
              current_category: "과일",
              current_difficulty: 1,
              hint_level: 0,
              recent_words: ["바나나"],
              started_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              ended_at: null,
            },
            error: null,
          };
        }
        if (table === "word_chain_game_sessions") {
          return {
            data: getWordChainSessionData() ?? {
              id: "wc-session-1",
              child_id: "child-1",
              chat_session_id: "session-1",
              state: "CHILD_TURN",
              initiated_by: "K",
              current_word: "사과",
              current_difficulty: 1,
              used_words: ["사과"],
              started_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              ended_at: null,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
      maybeSingle: async () => {
        if (table === "chosung_game_sessions") {
          return { data: getChosungSessionData(), error: null };
        }
        if (table === "word_chain_game_sessions") {
          return { data: getWordChainSessionData(), error: null };
        }
        if (table === "nonsense_game_sessions") {
          return { data: getNonsenseSessionData(), error: null };
        }
        if (table === "k_peer_personas") {
          return {
            data: {
              given_name: "민준",
              real_grade: 3,
              grade_label: "3학년",
              peer_age: 10,
              current_stage: "STAGE_3_FRIEND",
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
      update: (data: any) => {
        if (options.onUpdate) {
          options.onUpdate(table, data);
        }
        return tableChain;
      },
      insert: () => tableChain,
    };
    return tableChain;
  };

  const client = {
    rpc: async () => ({ data: null, error: null }),
    from: (table: string) => {
      if (
        options.throwOnActiveSession &&
        (table === "chosung_game_sessions" || table === "word_chain_game_sessions" || table === "nonsense_game_sessions")
      ) {
        throw new Error("DB crash in game session query");
      }
      return createTableChain(table);
    },
  };

  return client as unknown as SupabaseClient;
}


test("Integration: Router가 handled=true면 지침(instruction)이 LLM 프롬프트에 실린다", async () => {
  let capturedSystemInstruction: string | undefined;

  const mockDb = createMockDbForRespond();
  const mockAi = {
    models: {
      generateContent: async (params: any) => {
        capturedSystemInstruction = params.config?.systemInstruction;
        return {
          text: "좋아, 초성게임 시작하자! 문제는 ㅇㅃ야.",
          usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 10 },
        };
      },
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "초성게임 하자",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  assert.ok(capturedSystemInstruction, "LLM systemInstruction이 전달되어야 함");
  assert.ok(
    capturedSystemInstruction?.includes("초성게임") ||
    capturedSystemInstruction?.includes("문제"),
    "Router의 지침이 프롬프트에 실려야 함"
  );
});

test("Integration: Router가 handled=false면 일반 자유대화 흐름과 동일하다", async () => {
  let capturedSystemInstruction: string | undefined;

  const mockDb = createMockDbForRespond();
  const mockAi = {
    models: {
      generateContent: async (params: any) => {
        capturedSystemInstruction = params.config?.systemInstruction;
        return {
          text: "오늘 학교에서 무슨 일 있었어?",
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 },
        };
      },
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "오늘 학교에서 친구랑 축구했어",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  assert.equal(result.text, "오늘 학교에서 무슨 일 있었어?");
  assert.ok(capturedSystemInstruction);
  assert.ok(
    !capturedSystemInstruction?.includes("[초성게임]") &&
    !capturedSystemInstruction?.includes("[끝말잇기]"),
    "일반 대화에서는 게임 추가 지침이 실리지 않아야 함"
  );
});

test("Integration: Router가 예외를 던져도 자유대화가 중단되지 않고 정상 진행된다 (실패 격리)", async () => {
  const mockDb = createMockDbForRespond({ throwOnActiveSession: true });
  const mockAi = {
    models: {
      generateContent: async () => ({
        text: "응 듣고 있어!",
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
      }),
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "오늘 날씨 좋다",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  assert.equal(result.text, "응 듣고 있어!");
});

test("Integration: 게임이 처리된(handled=true) 턴에는 PLAY_PROPOSAL이 나오지 않는다", async () => {
  const mockDb = createMockDbForRespond();
  const mockAi = {
    models: {
      generateContent: async () => ({
        text: "끝말잇기 시작하자! 첫 단어는 사과야.",
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 10 },
      }),
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "끝말잇기 하자",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  assert.notEqual(
    result.action,
    "PLAY_PROPOSAL",
    "게임이 시작되거나 진행된 턴에는 PLAY_PROPOSAL이 아닌 일반 액션/게임 액션이어야 함"
  );
});

test("Integration: 초성게임 기존 동작이 회귀하지 않는다", async () => {
  let capturedInstruction: string | undefined;

  const mockDb = createMockDbForRespond();
  const mockAi = {
    models: {
      generateContent: async (params: any) => {
        capturedInstruction = params.config?.systemInstruction;
        return {
          text: "초성 퀴즈 시작! 자음은 ㅂㄴㄴ야.",
          usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 10 },
        };
      },
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "초성 퀴즈 내줘",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  assert.ok(capturedInstruction);
  assert.ok(
    capturedInstruction?.includes("초성게임") ||
    capturedInstruction?.includes("문제"),
    "초성게임 시작 지침이 포함되어야 함"
  );
});

/** 2026-08-17 Production 사고 회귀 고정.
 *
 *  박서현 계정 자유대화에서 아이가 "나도 반가워" 라고 한 번 말했는데 케이가
 *  "두 번 말할 정도로 반가웠나 봐" 라고 답했다. 아이는 "내가 말하는 거 두 번씩
 *  들어가" 라고 했다.
 *
 *  원인: 아이 발화는 /api/chat/messages 로 먼저 저장된 뒤 응답 요청이 간다.
 *  그래서 세션 이력의 마지막 턴이 곧 현재 발화인데, 거기에 currentUtterance 를
 *  또 붙여 Gemini 에 넘겼다. filterRecentHistory 에 제거 로직이 있었지만
 *  `currentUtteranceAlreadyInSession === true` 일 때만 동작했고
 *  **자유대화·미션 어느 경로도 그 플래그를 넘기지 않았다.** */
test("filterRecentHistory: 저장된 현재 발화가 이력 끝에 있으면 플래그 없이도 제거한다", () => {
  const history = filterRecentHistory(
    [
      { role: "child", content: "안녕 케이야" },
      { role: "k", content: "안녕 서현아!" },
      { role: "child", content: "나도 반가워" },
    ] as never,
    "나도 반가워",
  );
  assert.deepEqual(
    history.map((t) => `${t.role}:${t.text}`),
    ["child:안녕 케이야", "k:안녕 서현아!"],
  );
});

test("filterRecentHistory: 아직 저장 전이면(마지막이 K) 아무것도 제거하지 않는다", () => {
  const history = filterRecentHistory(
    [
      { role: "child", content: "안녕 케이야" },
      { role: "k", content: "안녕 서현아!" },
    ] as never,
    "나도 반가워",
  );
  assert.equal(history.length, 2);
});

test("filterRecentHistory: 아이가 정말 같은 말을 두 번 하면 마지막 하나만 제거한다", () => {
  const history = filterRecentHistory(
    [
      { role: "child", content: "응" },
      { role: "k", content: "응?" },
      { role: "child", content: "응" },
      { role: "child", content: "응" },
    ] as never,
    "응",
  );
  assert.deepEqual(
    history.map((t) => `${t.role}:${t.text}`),
    ["child:응", "k:응?", "child:응"],
  );
});

// ============================================================================
// 2026-08-17 Production 사고 방지 회귀 방어 테스트 (5종)
// ============================================================================

test("Guard Test 1: 활성 세션 없음 + Router 미처리 → 프롬프트에 게임 금지 지침이 들어간다", async () => {
  let capturedInstruction: string | undefined;

  const mockDb = createMockDbForRespond();
  const mockAi = {
    models: {
      generateContent: async (params: any) => {
        capturedInstruction = params.config?.systemInstruction;
        return {
          text: "오늘 날씨 맑아서 좋아!",
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 },
        };
      },
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "오늘 날씨 어때?",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  assert.ok(capturedInstruction);
  assert.match(capturedInstruction, /\[놀이 진행 금지 지침\]/);
  assert.match(capturedInstruction, /지금은 게임\(초성게임, 끝말잇기 등\)이 진행 중이 아니야\./);
  assert.match(capturedInstruction, /초성 문제\(ㄱㅊ 같은 자음\)를 내거나 끝말잇기 단어를 제시하지 마\./);
  assert.match(capturedInstruction, /정답·힌트·글자 수를 말하지 마\./);
  assert.match(capturedInstruction, /아이가 게임을 하자고 하면 "좋아, 시작하자" 정도로만 답하고 실제 문제는 시스템이 낼 때까지 기다려\./);
});

test("Guard Test 2: 세션 없이 아이가 '초성게임 하자'고 발화해도 문제 출제 금지 지침이 포함된다", async () => {
  let capturedInstruction: string | undefined;

  // sessionId 없이 호출하여 Router가 처리하지 않는 턴 상황 시뮬레이션
  const mockDb = createMockDbForRespond();
  const mockAi = {
    models: {
      generateContent: async (params: any) => {
        capturedInstruction = params.config?.systemInstruction;
        return {
          text: "좋아, 시작하자!",
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 6 },
        };
      },
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      mode: "FREE_CHAT",
      currentUtterance: "초성게임 하자",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  assert.notEqual(result.action, "PLAYFUL_GAME_CHOSUNG", "세션 없이는 게임 액션이 차단되어야 함");
  assert.ok(capturedInstruction);
  assert.match(capturedInstruction, /\[놀이 진행 금지 지침\]/);
  assert.match(capturedInstruction, /초성 문제\(ㄱㅊ 같은 자음\)를 내거나 끝말잇기 단어를 제시하지 마\./);
  assert.match(capturedInstruction, /아이가 게임을 하자고 하면 "좋아, 시작하자" 정도로만 답하고 실제 문제는 시스템이 낼 때까지 기다려\./);
});

test("Guard Test 3: 활성 세션 있음 → 금지 지침이 들어가지 않는다", async () => {
  let capturedInstruction: string | undefined;

  const mockDb = createMockDbForRespond({
    activeChosungSession: { id: "cs-session-1", current_word: "사과" },
  });
  const mockAi = {
    models: {
      generateContent: async (params: any) => {
        capturedInstruction = params.config?.systemInstruction;
        return {
          text: "응 듣고 있어!",
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        };
      },
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "안녕",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  assert.ok(capturedInstruction);
  assert.equal(
    capturedInstruction.includes("[놀이 진행 금지 지침]"),
    false,
    "활성 세션이 있을 때는 금지 지침이 들어가지 않아야 함"
  );
});

test("Guard Test 4: 스킬이 준 지침(문제·정답·힌트)이 프롬프트에 그대로 전달되고 놀이 진행 규칙이 적용된다", async () => {
  let capturedInstruction: string | undefined;

  const mockDb = createMockDbForRespond();
  const mockAi = {
    models: {
      generateContent: async (params: any) => {
        capturedInstruction = params.config?.systemInstruction;
        return {
          text: "초성 퀴즈 시작! 자음은 ㅂㄴㄴ야.",
          usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 10 },
        };
      },
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "초성 퀴즈 내줘",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  assert.ok(capturedInstruction);
  assert.equal(capturedInstruction.includes("[놀이 진행 금지 지침]"), false);
  assert.match(capturedInstruction, /\[놀이 진행 규칙\]/);
  assert.match(capturedInstruction, /시스템이 제공한 놀이 지침\(문제 초성, 제시 단어, 정답, 힌트 등\)을 반드시 그대로 사용해\./);
  assert.match(capturedInstruction, /시스템이 지정한 초성이나 제시 단어를 다른 것으로 바꾸거나, 새 문제를 임의로 지어내지 마\./);
  assert.match(capturedInstruction, /글자 수나 힌트 내용을 임의로 바꾸지 말고/);
  assert.ok(
    capturedInstruction.includes("초성게임") ||
    capturedInstruction.includes("문제"),
    "스킬의 지침이 프롬프트에 실려야 함"
  );
});

test("Guard Test 5: 기존 자유대화(게임 무관)에는 영향이 없다", async () => {
  let capturedInstruction: string | undefined;

  const mockDb = createMockDbForRespond();
  const mockAi = {
    models: {
      generateContent: async (params: any) => {
        capturedInstruction = params.config?.systemInstruction;
        return {
          text: "친구랑 축구해서 신났겠다!",
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 },
        };
      },
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "오늘 학교에서 친구랑 축구했어",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  assert.equal(result.text, "친구랑 축구해서 신났겠다!");
  assert.ok(capturedInstruction);
  assert.match(capturedInstruction, /\[K Core Persona - 내부 지침\]/);
  assert.match(capturedInstruction, /\[Grade Persona\]/);
  assert.match(capturedInstruction, /\[출력 규칙\]/);
});

// ============================================================================
// 2026-08-17 미션 중 놀이(게임) 완전 차단 검증 테스트 (5종)
// ============================================================================

test("Mission Block Test 1: mode=MISSION이면 활성 게임 세션이 있어도 routePlaySkillTurn이 호출되지 않고 조용히 세션이 정리된다", async () => {
  let capturedInstruction: string | undefined;
  const updatedTables: string[] = [];

  const mockDb = createMockDbForRespond({
    activeWordChainSession: {
      id: "wc-session-1",
      current_word: "사과",
      used_words: ["사과"],
    },
    onUpdate: (table) => {
      updatedTables.push(table);
    },
  });

  const mockAi = {
    models: {
      generateContent: async (params: any) => {
        capturedInstruction = params.config?.systemInstruction;
        return {
          text: "오늘 학교에서 무슨 과목 배웠어?",
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 },
        };
      },
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "MISSION",
      currentUtterance: "이여서 진행 되니",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
      adapterInstruction: "오늘 수업에 대해 질문해줘.",
    }
  );

  assert.equal(result.category, "generated");
  assert.notEqual(result.action, "PLAYFUL_GAME_WORD_CHAIN");
  assert.ok(capturedInstruction);
  assert.equal(
    capturedInstruction.includes("[끝말잇기]"),
    false,
    "미션 중에는 끝말잇기 턴 지침이 실리지 않아야 함"
  );
  assert.match(capturedInstruction, /\[미션 중 놀이 진행 및 제안 절대 금지\]/);
  // 남아있던 word_chain_game_sessions 종료 여부 확인
  assert.ok(
    updatedTables.includes("word_chain_game_sessions"),
    "미션 진입 시 남아있던 활성 세션이 조용히 종료 처리되어야 함"
  );
});

test("Mission Block Test 2: mode=MISSION이면 decidePlayProposal이 호출되지 않고 action이 PLAY_PROPOSAL이 되지 않는다", async () => {
  let capturedInstruction: string | undefined;

  const mockDb = createMockDbForRespond();
  const mockAi = {
    models: {
      generateContent: async (params: any) => {
        capturedInstruction = params.config?.systemInstruction;
        return {
          text: "심심했구나! 오늘 학교는 어땠어?",
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 },
        };
      },
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "MISSION",
      currentUtterance: "너무 심심해 뭐 할 거 없어?", // 지루함/놀이 요청 신호
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
      adapterInstruction: "오늘 하루에 대해 물어봐줘.",
    }
  );

  assert.equal(result.category, "generated");
  assert.notEqual(
    result.action,
    "PLAY_PROPOSAL",
    "미션에서는 PLAY_PROPOSAL 액션이 발생하지 않아야 함"
  );
  assert.ok(capturedInstruction);
  assert.equal(
    capturedInstruction.includes("[놀이 제안 지침]"),
    false,
    "미션에서는 놀이 제안 지침이 프롬프트에 실리지 않아야 함"
  );
});

test("Mission Block Test 3: mode=MISSION에서 아이가 '끝말잇기 하자'라고 해도 게임이 시작되지 않는다", async () => {
  let capturedInstruction: string | undefined;

  const mockDb = createMockDbForRespond();
  const mockAi = {
    models: {
      generateContent: async (params: any) => {
        capturedInstruction = params.config?.systemInstruction;
        return {
          text: "끝말잇기는 미션 끝나고 하자! 오늘 숙제는 다 했어?",
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 10 },
        };
      },
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "MISSION",
      currentUtterance: "끝말잇기 하자",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
      adapterInstruction: "오늘 숙제 여부를 확인해줘.",
    }
  );

  assert.equal(result.category, "generated");
  assert.notEqual(result.action, "PLAYFUL_GAME_WORD_CHAIN");
  assert.notEqual(result.action, "PLAY_PROPOSAL");
  assert.ok(capturedInstruction);
  assert.equal(
    capturedInstruction.includes("[끝말잇기]"),
    false,
    "미션 중에는 끝말잇기 시작 지침이 실리지 않아야 함"
  );
  assert.match(capturedInstruction, /\[미션 중 놀이 진행 및 제안 절대 금지\]/);
});

test("Mission Block Test 4: mode=MISSION 프롬프트에 게임 금지 지침이 정확히 포함된다", async () => {
  let capturedInstruction: string | undefined;

  const mockDb = createMockDbForRespond();
  const mockAi = {
    models: {
      generateContent: async (params: any) => {
        capturedInstruction = params.config?.systemInstruction;
        return {
          text: "오늘 점심 맛있었어?",
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 6 },
        };
      },
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "MISSION",
      currentUtterance: "안녕 케이야",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
      adapterInstruction: "오늘 점심 메뉴를 물어봐줘.",
    }
  );

  assert.equal(result.category, "generated");
  assert.ok(capturedInstruction);
  assert.match(capturedInstruction, /\[미션 중 놀이 진행 및 제안 절대 금지\]/);
  assert.match(capturedInstruction, /지금은 미션 대화다\. 놀이·게임을 진행하지도, 제안하지도 마라\./);
  assert.match(capturedInstruction, /초성게임·끝말잇기·넌센스 퀴즈의 문제·정답·힌트·규칙을 절대 말하지 마라\./);
  assert.match(capturedInstruction, /아이가 게임이나 놀이를 하자고 하면 "미션 끝나고 하자" 정도로 짧게 답하고 미션 질문이나 대화로 자연스럽게 돌아가라\./);
});

test("Mission Block Test 5: mode=FREE_CHAT에서는 기존 놀이 동작이 그대로 유지된다 (회귀 방지)", async () => {
  let capturedInstruction: string | undefined;

  const mockDb = createMockDbForRespond();
  const mockAi = {
    models: {
      generateContent: async (params: any) => {
        capturedInstruction = params.config?.systemInstruction;
        return {
          text: "초성퀴즈 시작! 문제는 ㅂㄴㄴ야.",
          usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8 },
        };
      },
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "초성게임 하자",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  assert.ok(capturedInstruction);
  assert.equal(
    capturedInstruction.includes("[미션 중 놀이 진행 및 제안 절대 금지]"),
    false,
    "자유대화에서는 미션 금지 지침이 없어야 함"
  );
  assert.ok(
    capturedInstruction.includes("초성게임") ||
    capturedInstruction.includes("문제"),
    "자유대화에서는 초성게임 지침이 정상 반영되어야 함"
  );
});

// ============================================================================
// 가짜 게임 출력 차단 가드 테스트 (Fake Gameplay Output Guard Tests)
// ============================================================================

test("Output Guard Test 1: 활성 세션 없이 게임 콘텐츠가 생성되면 차단되고 대체 문구가 나간다", async () => {
  const mockDb = createMockDbForRespond();
  const mockAi = {
    models: {
      generateContent: async () => ({
        // 활성 세션이 없는데 LLM이 지침을 무시하고 가짜 초성+넌센스 출제
        text: "'ㄸㄱ'야! 빨갛고 달콤한 과일인데 뭘까?",
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8 },
      }),
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "오늘 뭐해?",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  // 차단되어 대체 문구로 변경되어야 함
  // 010 — 대체 문구는 하나로 고정하지 않는다. 같은 말이 반복되면 아이가 바로 알아챈다.
  // 지어낸 게임 진행이 차단됐고, 아이에게 무엇을 할지 되묻는 문장이 나가면 된다.
  assert.ok(
    /놀이|골라|할까|할래/.test(result.text),
    `차단 후 대체 문구가 아니다: ${result.text}`
  );
  assert.ok(!/ㄱ|ㄴ|ㄷ|ㅁ|ㅂ|ㅅ|ㅇ|ㅈ/.test(result.text), "차단했는데 초성이 남아 있다");
});

test("Output Guard Test 2: 활성 세션이 있으면 정상 게임 출력이 차단되지 않는다 (회귀 방지)", async () => {
  // 활성 초성 세션이 있는 상태 모킹
  const mockDb = createMockDbForRespond({
    activeChosungSession: {
      id: "chosung-1",
      current_chosung: "ㅂㄴㄴ",
      current_word: "바나나",
    },
  });
  const mockAi = {
    models: {
      generateContent: async () => ({
        text: "초성 퀴즈 시작! 문제는 'ㅂㄴㄴ'야. 맞혀봐!",
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8 },
      }),
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "바나나",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  // 활성 세션이 있으므로 차단되지 않고 그대로 전달되어야 함
  assert.ok(result.text.includes("ㅂㄴㄴ"));
});

test("Output Guard Test 4: 초성게임 힌트 턴에서 정답이 유출되면 안전한 대체 문구로 치환된다", async () => {
  const mockDb = createMockDbForRespond({
    activeChosungSession: {
      id: "cs-session-1",
      current_chosung: "ㄸㄱ",
      current_word: "딸기",
      hint_level: 1,
    },
  });
  const mockAi = {
    models: {
      generateContent: async () => ({
        text: "정답은 딸기잖아! 딸기인 걸 왜 몰라?",
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8 },
      }),
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "힌트 줘",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  // 정답 "딸기"가 유출되지 않고 안전한 대체 문구로 변경되어야 함
  assert.equal(result.text.includes("딸기"), false);
  assert.ok(result.text.includes("힌트 하나 더 줄게"));
});

test("Output Guard Test 5: 초성 세션 활성 상태에서 케이가 끝말잇기를 환각 진행하면 차단된다 (2026-08-17 사고 재현)", async () => {
  // 초성 세션 활성 상태 모킹
  const mockDb = createMockDbForRespond({
    activeChosungSession: {
      id: "chosung-1",
      current_chosung: "ㅂㄴㄴ",
      current_word: "바나나",
    },
  });
  const mockAi = {
    models: {
      generateContent: async () => ({
        // 초성 세션인데 케이가 끝말잇기를 진행 (사고 상황 재현)
        text: "일마루! 내 차례네, 그럼 '루브르 박물관'!",
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8 },
      }),
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "파일",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  // 활성 세션은 초성인데 끝말잇기(WORD_CHAIN)를 진행했으므로 차단되어 대체 문구로 변경되어야 함
  // 010 — 대체 문구는 하나로 고정하지 않는다. 같은 말이 반복되면 아이가 바로 알아챈다.
  // 지어낸 게임 진행이 차단됐고, 아이에게 무엇을 할지 되묻는 문장이 나가면 된다.
  assert.ok(
    /놀이|골라|할까|할래/.test(result.text),
    `차단 후 대체 문구가 아니다: ${result.text}`
  );
  assert.ok(!/ㄱ|ㄴ|ㄷ|ㅁ|ㅂ|ㅅ|ㅇ|ㅈ/.test(result.text), "차단했는데 초성이 남아 있다");
});

test("Output Guard Test 6: MISSION 모드에서는 가짜 게임 가드를 검사하지 않는다", async () => {
  const mockDb = createMockDbForRespond();
  const mockAi = {
    models: {
      generateContent: async () => ({
        text: "미션 중이지만 'ㄸㄱ' 같은 단어가 포함될 수 있어.",
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8 },
      }),
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "MISSION",
      currentUtterance: "미션 진행 중",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
      adapterInstruction: "[미션 컨텍스트]",
    }
  );

  assert.equal(result.category, "generated");
  // MISSION 모드에서는 가짜 게임 출력 차단 가드가 동작하지 않으므로 텍스트가 유지됨
  assert.ok(result.text.includes("ㄸㄱ"));
});

test("WordChain Output Guard 1: 응답에 requiredWord가 있으면 정상 통과", async () => {
  const mockDb = createMockDbForRespond({
    activeWordChainSession: {
      id: "wc-session-1",
      current_word: "사과",
      used_words: ["사과"],
    },
  });
  let capturedInstruction: string | undefined;
  const mockAi = {
    models: {
      generateContent: async (params: any) => {
        capturedInstruction = params.config?.systemInstruction;
        // instruction에서 케이가 낼 단어 추출 (예: 케이는 "과자"로 받을게)
        const match = capturedInstruction?.match(/케이는\s*"([^"]+)"/);
        const kWord = match ? match[1] : "과자";
        return {
          text: `좋아! 나는 '${kWord}' 할게! 다음 단어 이어줘.`,
          usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8 },
        };
      },
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "과자",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  assert.ok(result.text.includes("좋아! 나는 '"));
});

test("WordChain Output Guard 2: 응답에 requiredWord가 없으면 대체 문구로 바뀌고 requiredWord가 들어 있다", async () => {
  const mockDb = createMockDbForRespond({
    activeWordChainSession: {
      id: "wc-session-1",
      current_word: "사과",
      used_words: ["사과"],
    },
  });
  const mockAi = {
    models: {
      generateContent: async () => ({
        // 모델이 requiredWord를 무시하고 엉뚱한 말을 함
        text: "와 멋진 단어야! 근데 다음엔 뭐 할까?",
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8 },
      }),
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "과자",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  // requiredWord가 포함된 대체 문구로 치환됨
  assert.ok(result.text.startsWith("좋아! 나는 '"));
  assert.ok(result.text.includes("할게. 이제 '"));
  assert.ok(result.text.includes("'로 시작하는 말 해줘!"));
});

test("WordChain Output Guard 3: 사고 재현 — 케이가 '그거로 시작하는 다음 단어는 뭘로 할래?' 라고만 하면 차단된다", async () => {
  const mockDb = createMockDbForRespond({
    activeWordChainSession: {
      id: "wc-session-1",
      current_word: "차표",
      used_words: ["차표"],
    },
  });
  const mockAi = {
    models: {
      generateContent: async () => ({
        // 2026-08-17 사고 실제 발화
        text: "오, 표창 짱 멋있지! 근데 그거로 시작하는 다음 단어는 뭘로 할래?",
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8 },
      }),
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "표범",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  // 케이가 자기가 단어를 안 내고 되던진 발화가 차단되고 대체 문구로 치환됨
  assert.ok(result.text.startsWith("좋아! 나는 '"));
  assert.ok(result.text.includes("할게. 이제 '"));
  assert.equal(result.text.includes("그거로 시작하는 다음 단어는 뭘로 할래?"), false);
});

test("WordChain Output Guard 4: 그만하기 턴은 requiredWordInOutput이 없어 검사 대상이 아니다", async () => {
  const mockDb = createMockDbForRespond({
    activeWordChainSession: {
      id: "wc-session-1",
      current_word: "사과",
      used_words: ["사과"],
    },
  });
  const mockAi = {
    models: {
      generateContent: async () => ({
        text: "그래, 끝말잇기 재미있었어! 다음에 또 같이 놀자.",
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8 },
      }),
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "끝말잇기 그만하자",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  assert.equal(result.text, "그래, 끝말잇기 재미있었어! 다음에 또 같이 놀자.");
});

test("WordChain Output Guard 5: 초성 검증(answerMustNotAppear)이 그대로 동작한다 (회귀 방어)", async () => {
  const mockDb = createMockDbForRespond({
    activeChosungSession: {
      id: "cs-session-1",
      current_chosung: "ㄸㄱ",
      current_word: "딸기",
      hint_level: 1,
    },
  });
  const mockAi = {
    models: {
      generateContent: async () => ({
        text: "정답은 딸기잖아! 딸기인 걸 왜 몰라?",
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8 },
      }),
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "모르겠어",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  assert.equal(result.text.includes("딸기"), false);
  assert.equal(result.text, "음, 힌트 하나 더 줄게! 초성을 잘 생각해서 맞춰봐.");
});

test("Chosung Output Guard 1: 응답에 requiredChosung이 있으면 정상 통과", async () => {
  const mockDb = createMockDbForRespond({
    activeChosungSession: {
      id: "cs-session-2",
      current_chosung: "ㄴㅇㅌ",
      current_word: "놀이터",
      hint_level: 0,
    },
  });
  const mockAi = {
    models: {
      generateContent: async () => ({
        text: "좋아! 초성은 'ㄴㅇㅌ'야. 맞춰봐!",
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8 },
      }),
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "초성게임 하자",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  assert.equal(result.text, "좋아! 초성은 'ㄴㅇㅌ'야. 맞춰봐!");
});

test("Chosung Output Guard 2: 사고 재현 — DB가 ㄴㅇㅌ인데 케이가 'ㅅㅇㅍ'로 지어내면 차단되고 대체 문구에 ㄴㅇㅌ가 들어간다 (2026-08-18 사고 수정)", async () => {
  const mockDb = createMockDbForRespond({
    activeChosungSession: {
      id: "cs-session-3",
      current_chosung: "ㄴㅇㅌ",
      current_word: "놀이터",
      hint_level: 0,
    },
  });
  const mockAi = {
    models: {
      generateContent: async () => ({
        text: "이번 문제는 ㅅㅇㅍ인데 맞혀봐!",
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8 },
      }),
    },
  };

  const result = await respond(
    {
      childId: "child-1",
      sessionId: "session-1",
      mode: "FREE_CHAT",
      currentUtterance: "초성게임 하자",
    },
    {
      db: mockDb,
      ai: mockAi,
      modelId: "test-model",
    }
  );

  assert.equal(result.category, "generated");
  assert.equal(result.text, "자, 다시 낼게! 초성은 'ㄴㅇㅌ' 이야. 뭘까?");
  assert.equal(result.text.includes("ㄴㅇㅌ"), true);
  assert.equal(result.text.includes("ㅅㅇㅍ"), false);
});






