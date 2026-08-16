import assert from "node:assert/strict";
import { test } from "node:test";

import { filterRecentHistory } from "./index";
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
  activeChosungSession?: { id: string; current_word?: string } | null;
  activeWordChainSession?: { id: string; current_word?: string; used_words?: string[] } | null;
  throwOnActiveSession?: boolean;
} = {}): SupabaseClient {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () => Promise.resolve({ data: null, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    update: () => chain,
    insert: () => chain,
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
      if (table === "chosung_game_sessions") {
        return {
          ...chain,
          maybeSingle: async () => ({
            data: options.activeChosungSession ?? null,
            error: null,
          }),
        };
      }
      if (table === "word_chain_game_sessions") {
        return {
          ...chain,
          maybeSingle: async () => ({
            data: options.activeWordChainSession ?? null,
            error: null,
          }),
        };
      }
      if (table === "k_peer_personas") {
        return {
          ...chain,
          maybeSingle: async () => ({
            data: {
              given_name: "민준",
              real_grade: 3,
              grade_label: "3학년",
              peer_age: 10,
              current_stage: "STAGE_3_FRIEND",
            },
            error: null,
          }),
        };
      }
      return chain;
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
