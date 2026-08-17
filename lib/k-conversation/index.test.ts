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
  throwOnActiveSession?: boolean;
} = {}): SupabaseClient {
  const getChosungSessionData = () => options.activeChosungSession ?? null;
  const getWordChainSessionData = () => options.activeWordChainSession ?? null;

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
        return { data: null, error: null };
      },
      maybeSingle: async () => {
        if (table === "chosung_game_sessions") {
          return { data: getChosungSessionData(), error: null };
        }
        if (table === "word_chain_game_sessions") {
          return { data: getWordChainSessionData(), error: null };
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
      update: () => tableChain,
      insert: () => tableChain,
    };
    return tableChain;
  };

  const client = {
    rpc: async () => ({ data: null, error: null }),
    from: (table: string) => {
      if (
        options.throwOnActiveSession &&
        (table === "chosung_game_sessions" || table === "word_chain_game_sessions")
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

