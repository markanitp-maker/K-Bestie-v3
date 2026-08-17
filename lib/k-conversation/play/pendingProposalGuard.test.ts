import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UtteranceSignals } from "../utteranceSignals";
import { extractUtteranceSignals } from "../utteranceSignals";
import type { PlaySkillModule, PlaySkillTurnResult } from "./skillTypes";
import { routePlaySkillTurn } from "./skillRouter";
import {
  setPendingPlayProposal,
  getPendingPlayProposal,
  clearPendingPlayProposal,
  clearAllPendingProposalsForTest,
} from "./pendingProposalStore";
import { respond, type RespondDependencies } from "../index";

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
  hasPlayRequestWithoutTarget: false,
  hasGenericPlayAcceptance: false,
  hasPlayRejection: false,
  hasPlayStop: false,
};

function createMockDb(initialSession?: { child_id?: string; pending_play_proposal?: any; turn_count?: number }): SupabaseClient {
  let chatSessionData: any = initialSession ? { ...initialSession } : null;
  const getChain = (table: string) => {
    const chain: any = {
      select: (cols?: string) => chain,
      eq: (col?: string, val?: string) => chain,
      is: () => chain,
      order: () => chain,
      limit: () => chain,
      single: () => Promise.resolve({ data: table === "chat_sessions" ? chatSessionData : null, error: null }),
      maybeSingle: () => Promise.resolve({ data: table === "chat_sessions" ? chatSessionData : null, error: null }),
      update: (payload: any) => {
        if (table === "chat_sessions" && payload && payload.pending_play_proposal !== undefined) {
          if (!chatSessionData) {
            chatSessionData = { pending_play_proposal: payload.pending_play_proposal };
          } else {
            chatSessionData.pending_play_proposal = payload.pending_play_proposal;
          }
        }
        return {
          eq: async () => ({ error: null }),
        };
      },
      insert: () => chain,
    };
    return chain;
  };
  return {
    from: (table: string) => getChain(table),
    rpc: () => Promise.resolve({ data: null, error: null }),
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  clearAllPendingProposalsForTest();
});

// Test 1: 단일 제안 + "응" → 그 스킬 start 시도
test("Test 1: 단일 제안 + '응' → 해당 스킬 start 시도", async () => {
  let chosungStartCalled = false;
  let wordChainStartCalled = false;

  const mockChosungSkill: PlaySkillModule = {
    id: "CHOSUNG",
    displayName: "초성게임",
    childFacingDescription: "초성 맞히기",
    proposal: { label: "초성게임", shortDescription: "초성 퀴즈" },
    matchesDirectRequest: (signals) => Boolean(signals.hasChosungGameStart),
    getActiveSession: async () => (chosungStartCalled ? { id: "cs-session-1" } : null),
    start: async () => {
      chosungStartCalled = true;
      return { handled: true, instruction: "[초성게임] 첫 문제 ㅂㄴㄴ" };
    },
    handleTurn: async () => ({ handled: true }),
    end: async () => {},
  };

  const mockWordChainSkill: PlaySkillModule = {
    id: "WORD_CHAIN",
    displayName: "끝말잇기",
    childFacingDescription: "끝말 잇기",
    proposal: { label: "끝말잇기", shortDescription: "단어 잇기" },
    matchesDirectRequest: (signals) => Boolean(signals.hasWordChainGameStart),
    getActiveSession: async () => null,
    start: async () => {
      wordChainStartCalled = true;
      return { handled: true, instruction: "[끝말잇기] 사과" };
    },
    handleTurn: async () => ({ handled: true }),
    end: async () => {},
  };

  const chatSessionId = "chat-test-1";
  const db = createMockDb();
  await setPendingPlayProposal({
    chatSessionId,
    childId: "child-1",
    offeredSkills: ["CHOSUNG"],
    proposedAt: Date.now(),
    initiatedBy: "k",
  }, db);

  const signals = extractUtteranceSignals("응");
  assert.equal(signals.hasGenericPlayAcceptance, true);

  const result = await routePlaySkillTurn({
    db,
    childId: "child-1",
    chatSessionId,
    gradeRaw: 3,
    utterance: "응",
    signals,
    registry: [mockChosungSkill, mockWordChainSkill],
  });

  assert.equal(chosungStartCalled, true, "단일 제안된 초성게임이 start 되어야 함");
  assert.equal(wordChainStartCalled, false, "끝말잇기는 start 되지 않아야 함");
  assert.equal(result.handled, true);
  assert.equal(result.instruction, "[초성게임] 첫 문제 ㅂㄴㄴ");
  assert.equal(await getPendingPlayProposal(chatSessionId, db), null, "성공 후 Pending Proposal은 정리되어야 함");
});

// Test 2: 복수 제안 + "좋아" → 임의 선택 안 함, 되묻기 (핵심)
test("Test 2: 복수 제안 + '좋아' → 임의 선택 안 함, 되묻기 (핵심)", async () => {
  let chosungStartCalled = false;
  let wordChainStartCalled = false;

  const mockChosungSkill: PlaySkillModule = {
    id: "CHOSUNG",
    displayName: "초성게임",
    childFacingDescription: "초성 맞히기",
    proposal: { label: "초성게임", shortDescription: "초성 퀴즈" },
    matchesDirectRequest: (signals) => Boolean(signals.hasChosungGameStart),
    getActiveSession: async () => null,
    start: async () => {
      chosungStartCalled = true;
      return { handled: true, instruction: "[초성게임] 첫 문제" };
    },
    handleTurn: async () => ({ handled: true }),
    end: async () => {},
  };

  const mockWordChainSkill: PlaySkillModule = {
    id: "WORD_CHAIN",
    displayName: "끝말잇기",
    childFacingDescription: "끝말 잇기",
    proposal: { label: "끝말잇기", shortDescription: "단어 잇기" },
    matchesDirectRequest: (signals) => Boolean(signals.hasWordChainGameStart),
    getActiveSession: async () => null,
    start: async () => {
      wordChainStartCalled = true;
      return { handled: true, instruction: "[끝말잇기] 첫 단어" };
    },
    handleTurn: async () => ({ handled: true }),
    end: async () => {},
  };

  const chatSessionId = "chat-test-2";
  const db = createMockDb();
  await setPendingPlayProposal({
    chatSessionId,
    childId: "child-1",
    offeredSkills: ["CHOSUNG", "WORD_CHAIN"],
    proposedAt: Date.now(),
    initiatedBy: "k",
  }, db);

  const signals = extractUtteranceSignals("좋아");
  assert.equal(signals.hasGenericPlayAcceptance, true);

  const result = await routePlaySkillTurn({
    db,
    childId: "child-1",
    chatSessionId,
    gradeRaw: 3,
    utterance: "좋아",
    signals,
    registry: [mockChosungSkill, mockWordChainSkill],
  });

  assert.equal(chosungStartCalled, false, "임의로 초성게임을 시작하면 안 됨");
  assert.equal(wordChainStartCalled, false, "임의로 끝말잇기를 시작하면 안 됨");
  assert.equal(result.handled, true);
  assert.match(result.instruction ?? "", /초성게임이랑 끝말잇기 중 뭐 할래\?/);
  assert.match(result.instruction ?? "", /절대 네가 먼저 특정 놀이를 시작하거나 문제를 내지 마/);

  // 되묻기 후에도 제안 상태는 유지되어 다음 턴 선택을 기다린다
  const pending = await getPendingPlayProposal(chatSessionId, db);
  assert.ok(pending);
  assert.equal(pending?.selectionRequired, true);
});

// Test 3: 복수 제안 + "초성게임" → 해당 스킬 start
test("Test 3: 복수 제안 + '초성게임' → 해당 스킬 start", async () => {
  let chosungStartCalled = false;
  let wordChainStartCalled = false;

  const mockChosungSkill: PlaySkillModule = {
    id: "CHOSUNG",
    displayName: "초성게임",
    childFacingDescription: "초성 맞히기",
    proposal: { label: "초성게임", shortDescription: "초성 퀴즈" },
    matchesDirectRequest: (signals, utterance) =>
      Boolean(signals.hasChosungGameStart) || utterance.includes("초성"),
    getActiveSession: async () => (chosungStartCalled ? { id: "cs-session-3" } : null),
    start: async () => {
      chosungStartCalled = true;
      return { handled: true, instruction: "[초성게임] 첫 문제 ㅅㄱ" };
    },
    handleTurn: async () => ({ handled: true }),
    end: async () => {},
  };

  const mockWordChainSkill: PlaySkillModule = {
    id: "WORD_CHAIN",
    displayName: "끝말잇기",
    childFacingDescription: "끝말 잇기",
    proposal: { label: "끝말잇기", shortDescription: "단어 잇기" },
    matchesDirectRequest: (signals, utterance) =>
      Boolean(signals.hasWordChainGameStart) || utterance.includes("끝말잇기"),
    getActiveSession: async () => null,
    start: async () => {
      wordChainStartCalled = true;
      return { handled: true, instruction: "[끝말잇기] 사과" };
    },
    handleTurn: async () => ({ handled: true }),
    end: async () => {},
  };

  const chatSessionId = "chat-test-3";
  const db = createMockDb();
  await setPendingPlayProposal({
    chatSessionId,
    childId: "child-1",
    offeredSkills: ["CHOSUNG", "WORD_CHAIN"],
    proposedAt: Date.now(),
    initiatedBy: "k",
    selectionRequired: true,
  }, db);

  const signals = extractUtteranceSignals("초성게임");
  const result = await routePlaySkillTurn({
    db,
    childId: "child-1",
    chatSessionId,
    gradeRaw: 3,
    utterance: "초성게임",
    signals,
    registry: [mockChosungSkill, mockWordChainSkill],
  });

  assert.equal(chosungStartCalled, true, "초성게임 start 가 호출되어야 함");
  assert.equal(wordChainStartCalled, false);
  assert.equal(result.handled, true);
  assert.equal(result.instruction, "[초성게임] 첫 문제 ㅅㄱ");
  assert.equal(await getPendingPlayProposal(chatSessionId, db), null, "선택 완료 후 정리되어야 함");
});

// Test 4: Pending 없이 "끝말잇기 하자" → 직접 진입
test("Test 4: Pending 없이 '끝말잇기 하자' → 직접 진입", async () => {
  let wordChainStartCalled = false;

  const mockWordChainSkill: PlaySkillModule = {
    id: "WORD_CHAIN",
    displayName: "끝말잇기",
    childFacingDescription: "끝말 잇기",
    proposal: { label: "끝말잇기", shortDescription: "단어 잇기" },
    matchesDirectRequest: (signals, utterance) =>
      Boolean(signals.hasWordChainGameStart) || utterance.includes("끝말잇기"),
    getActiveSession: async () => (wordChainStartCalled ? { id: "wc-session-4" } : null),
    start: async () => {
      wordChainStartCalled = true;
      return { handled: true, instruction: "[끝말잇기] 바나나" };
    },
    handleTurn: async () => ({ handled: true }),
    end: async () => {},
  };

  const chatSessionId = "chat-test-4";
  const db = createMockDb();
  assert.equal(await getPendingPlayProposal(chatSessionId, db), null);

  const signals = extractUtteranceSignals("끝말잇기 하자");
  assert.equal(signals.hasWordChainGameStart, true);

  const result = await routePlaySkillTurn({
    db,
    childId: "child-1",
    chatSessionId,
    gradeRaw: 3,
    utterance: "끝말잇기 하자",
    signals,
    registry: [mockWordChainSkill],
  });

  assert.equal(wordChainStartCalled, true);
  assert.equal(result.handled, true);
  assert.equal(result.instruction, "[끝말잇기] 바나나");
});

// Test 5: start 실패 시 gameplay instruction 이 생성되지 않는가 (핵심)
test("Test 5: start 실패 시 gameplay instruction 이 생성되지 않는가 (핵심 Hard Guard)", async () => {
  const failingSkill: PlaySkillModule = {
    id: "CHOSUNG",
    displayName: "초성게임",
    childFacingDescription: "초성 맞히기",
    proposal: { label: "초성게임", shortDescription: "초성 퀴즈" },
    matchesDirectRequest: () => true,
    getActiveSession: async () => null, // 세션 생성 안 됨
    start: async () => {
      // DB 에러 등으로 handled: false 반환
      return { handled: false };
    },
    handleTurn: async () => ({ handled: false }),
    end: async () => {},
  };

  const chatSessionId = "chat-test-5";
  const db = createMockDb();
  await setPendingPlayProposal({
    chatSessionId,
    childId: "child-1",
    offeredSkills: ["CHOSUNG"],
    proposedAt: Date.now(),
    initiatedBy: "k",
  }, db);

  const signals = extractUtteranceSignals("응");
  const result = await routePlaySkillTurn({
    db,
    childId: "child-1",
    chatSessionId,
    gradeRaw: 3,
    utterance: "응",
    signals,
    registry: [failingSkill],
  });

  assert.equal(result.handled, false);
  assert.equal(result.instruction, undefined, "start 실패 시 instruction 이 절대 반환되지 않아야 함");
});

// Test 6: 활성 세션 없는데 gameplay instruction 이 나가지 않는가 (Hard Guard)
test("Test 6: 활성 세션 없는데 단어 입력이나 일반 발화 시 gameplay instruction 차단", async () => {
  const mockChosungSkill: PlaySkillModule = {
    id: "CHOSUNG",
    displayName: "초성게임",
    childFacingDescription: "초성 맞히기",
    proposal: { label: "초성게임", shortDescription: "초성 퀴즈" },
    matchesDirectRequest: (signals) => Boolean(signals.hasChosungGameStart),
    getActiveSession: async () => null, // 활성 세션 없음
    start: async () => ({ handled: false }),
    handleTurn: async () => ({ handled: false }),
    end: async () => {},
  };

  const mockWordChainSkill: PlaySkillModule = {
    id: "WORD_CHAIN",
    displayName: "끝말잇기",
    childFacingDescription: "끝말 잇기",
    proposal: { label: "끝말잇기", shortDescription: "단어 잇기" },
    matchesDirectRequest: (signals) => Boolean(signals.hasWordChainGameStart),
    getActiveSession: async () => null, // 활성 세션 없음
    start: async () => ({ handled: false }),
    handleTurn: async () => ({ handled: false }),
    end: async () => {},
  };

  // 1. "사과" (초성 정답 시도로 오인될 수 있는 2자 단어 발화)
  const signals = extractUtteranceSignals("사과");
  const result = await routePlaySkillTurn({
    db: createMockDb(),
    childId: "child-1",
    chatSessionId: "chat-test-6",
    gradeRaw: 3,
    utterance: "사과",
    signals,
    registry: [mockChosungSkill, mockWordChainSkill],
  });

  assert.equal(result.handled, false, "활성 세션이 없으면 handled: false여야 함");
  assert.equal(result.instruction, undefined, "활성 세션 없으면 gameplay instruction 생성 0건");
});

// Test 7: 제안 후 부정감정 발화 → 수락으로 처리하지 않는가
test("Test 7: 제안 후 부정감정 발화 → 수락으로 처리하지 않고 proposal 정리", async () => {
  let chosungStartCalled = false;

  const mockChosungSkill: PlaySkillModule = {
    id: "CHOSUNG",
    displayName: "초성게임",
    childFacingDescription: "초성 맞히기",
    proposal: { label: "초성게임", shortDescription: "초성 퀴즈" },
    matchesDirectRequest: (signals) => Boolean(signals.hasChosungGameStart),
    getActiveSession: async () => null,
    start: async () => {
      chosungStartCalled = true;
      return { handled: true, instruction: "[초성게임] 문제" };
    },
    handleTurn: async () => ({ handled: true }),
    end: async () => {},
  };

  const chatSessionId = "chat-test-7";
  const db = createMockDb();
  await setPendingPlayProposal({
    chatSessionId,
    childId: "child-1",
    offeredSkills: ["CHOSUNG"],
    proposedAt: Date.now(),
    initiatedBy: "k",
  }, db);

  // "오늘 학교에서 너무 속상했어"
  const signals = extractUtteranceSignals("오늘 학교에서 너무 속상했어");
  assert.equal(signals.hasNegativeEmotion, true);
  assert.equal(signals.hasGenericPlayAcceptance, false);

  const result = await routePlaySkillTurn({
    db,
    childId: "child-1",
    chatSessionId,
    gradeRaw: 3,
    utterance: "오늘 학교에서 너무 속상했어",
    signals,
    registry: [mockChosungSkill],
  });

  assert.equal(chosungStartCalled, false, "부정감정 발화에서 게임이 시작되면 안 됨");
  assert.equal(result.handled, false);
  assert.equal(await getPendingPlayProposal(chatSessionId, db), null, "Pending Proposal은 정리되어야 함");
});

// Test 8: 거절 후 제안 상태가 정리되는가
test("Test 8: 거절('싫어') 후 제안 상태가 정리되는가", async () => {
  const chatSessionId = "chat-test-8";
  const db = createMockDb();
  await setPendingPlayProposal({
    chatSessionId,
    childId: "child-1",
    offeredSkills: ["CHOSUNG", "WORD_CHAIN"],
    proposedAt: Date.now(),
    initiatedBy: "k",
  }, db);

  const signals = extractUtteranceSignals("싫어");
  assert.equal(signals.hasPlayRejection, true);

  const result = await routePlaySkillTurn({
    db,
    childId: "child-1",
    chatSessionId,
    gradeRaw: 3,
    utterance: "싫어",
    signals,
    registry: [],
  });

  assert.equal(result.handled, false);
  assert.equal(await getPendingPlayProposal(chatSessionId, db), null, "거절 시 Pending Proposal이 정리되어야 함");
});

// Test 9: Topic Shift 후 제안 상태가 정리되는가
test("Test 9: Topic Shift(일상 화제 전환) 후 제안 상태가 정리되는가", async () => {
  const chatSessionId = "chat-test-9";
  const db = createMockDb();
  await setPendingPlayProposal({
    chatSessionId,
    childId: "child-1",
    offeredSkills: ["CHOSUNG"],
    proposedAt: Date.now(),
    initiatedBy: "k",
  }, db);

  // 게임 수락이 아닌 다른 일상 대화
  const signals = extractUtteranceSignals("나 오늘 피자 먹었어");
  assert.equal(signals.hasGenericPlayAcceptance, false);

  const result = await routePlaySkillTurn({
    db,
    childId: "child-1",
    chatSessionId,
    gradeRaw: 3,
    utterance: "나 오늘 피자 먹었어",
    signals,
    registry: [],
  });

  assert.equal(result.handled, false);
  assert.equal(await getPendingPlayProposal(chatSessionId, db), null, "무관한 대화 시 Pending Proposal이 정리되어야 함");
});

// Test 10: 기존 006 통합 엔진 respond() 검증 - Proposal 상태 생성 및 수락 전주기
test("Test 10: Engine respond() 연동 - 복수 제안 후 되묻기 및 포괄 수락 전주기", async () => {
  const db = createMockDb();
  let generatedSystemInstruction = "";

  const mockAi = {
    models: {
      generateContent: async (params: any) => {
        generatedSystemInstruction = params.config?.systemInstruction ?? "";
        return {
          text: "초성게임이랑 끝말잇기 중 뭐 할래?",
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
        };
      },
    },
  };

  const chatSessionId = "chat-session-engine-10";

  // 턴 1: 아이가 "심심해" -> Engine이 복수 놀이 제안
  const turn1Output = await respond(
    {
      childId: "child-1",
      sessionId: chatSessionId,
      mode: "FREE_CHAT",
      currentUtterance: "심심해",
    },
    {
      db,
      ai: mockAi as any,
      modelId: "mock-model",
    }
  );

  assert.equal(turn1Output.action, "PLAY_PROPOSAL");
  const proposal = await getPendingPlayProposal(chatSessionId, db);
  assert.ok(proposal, "엔진이 제안 후 Pending Proposal이 저장되어야 함");
  assert.ok(proposal?.offeredSkills && proposal.offeredSkills.length >= 2, "복수 스킬이 제안되어야 함");

  // 턴 2: 아이가 "게임부터 하자" -> 복수 제안 포괄 수락이므로 되묻기 처리
  const turn2Output = await respond(
    {
      childId: "child-1",
      sessionId: chatSessionId,
      mode: "FREE_CHAT",
      currentUtterance: "게임부터 하자",
    },
    {
      db,
      ai: mockAi as any,
      modelId: "mock-model",
    }
  );

  assert.match(generatedSystemInstruction, /초성게임.*끝말잇기.*중 뭐 할래\?/);
  assert.match(generatedSystemInstruction, /절대 네가 먼저 특정 놀이를 시작하거나 문제를 내지 마/);
});

// Test 11: DB 기반 저장/조회 검증 (프로세스 메모리에 의존하지 않고 주입한 DB 저장소에서 상태 복원)
test("Test 11: 저장·조회가 프로세스 메모리에 의존하지 않고 DB 영속 저장소에서 복원되는지 검증", async () => {
  const chatSessionId = "chat-db-session-11";
  let dbStoredProposal: any = null;

  const mockDbWithStorage = {
    from: (table: string) => {
      assert.equal(table, "chat_sessions");
      return {
        select: (cols: string) => ({
          eq: (col: string, val: string) => ({
            maybeSingle: async () => {
              assert.equal(col, "id");
              assert.equal(val, chatSessionId);
              return { data: { pending_play_proposal: dbStoredProposal }, error: null };
            },
          }),
        }),
        update: (payload: any) => ({
          eq: async (col: string, val: string) => {
            assert.equal(col, "id");
            assert.equal(val, chatSessionId);
            dbStoredProposal = payload.pending_play_proposal;
            return { error: null };
          },
        }),
      };
    },
  } as unknown as SupabaseClient;

  // 1. 제안 저장
  await setPendingPlayProposal(
    {
      chatSessionId,
      childId: "child-1",
      offeredSkills: ["CHOSUNG", "WORD_CHAIN"],
      proposedAt: Date.now(),
      initiatedBy: "k",
    },
    mockDbWithStorage
  );

  assert.ok(dbStoredProposal, "DB 행에 pending_play_proposal이 저장되어야 함");
  assert.deepEqual(dbStoredProposal.offeredSkills, ["CHOSUNG", "WORD_CHAIN"]);

  // 2. 프로세스 인메모리 저장소를 완전히 날려버림 (다른 서버리스 인스턴스 시뮬레이션)
  clearAllPendingProposalsForTest();

  // 3. 인메모리가 비어있어도 DB에서 읽어와야 함
  const restored = await getPendingPlayProposal(chatSessionId, mockDbWithStorage);
  assert.ok(restored, "인메모리가 비어있어도 DB에서 제안이 복원되어야 함");
  assert.equal(restored?.chatSessionId, chatSessionId);
  assert.deepEqual(restored?.offeredSkills, ["CHOSUNG", "WORD_CHAIN"]);

  // 4. clear 시 DB 컬럼도 null로 변경되는지 검증
  await clearPendingPlayProposal(chatSessionId, mockDbWithStorage);
  assert.equal(dbStoredProposal, null, "clear 시 DB 컬럼이 null로 업데이트되어야 함");

  clearAllPendingProposalsForTest();
  const restoredAfterClear = await getPendingPlayProposal(chatSessionId, mockDbWithStorage);
  assert.equal(restoredAfterClear, null, "정리 후에는 DB 조회 결과도 null이어야 함");
});

// Test 12: DB 실패 시에도 fail-safe 로 대화가 죽지 않고 계속 진행되는지 검증
test("Test 12: DB 쿼리/업데이트 실패 시 대화가 죽지 않고 계속 진행(fail-safe)되는지 검증", async () => {
  const chatSessionId = "chat-db-failing-session-12";

  const throwingDb = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            throw new Error("DB Connection Error or Column Missing");
          },
        }),
      }),
      update: () => ({
        eq: async () => {
          throw new Error("DB Update Error");
        },
      }),
    }),
  } as unknown as SupabaseClient;

  // 1. DB 예외 상황에서 setPendingPlayProposal 호출 시 throw하지 않음
  await assert.doesNotReject(async () => {
    await setPendingPlayProposal(
      {
        chatSessionId,
        childId: "child-1",
        offeredSkills: ["CHOSUNG"],
        proposedAt: Date.now(),
        initiatedBy: "k",
      },
      throwingDb
    );
  }, "DB 오류 시 setPendingPlayProposal이 예외를 throw하면 안 됨");

  // 2. DB 예외 상황에서 getPendingPlayProposal 호출 시 throw하지 않고 폴백 반환
  await assert.doesNotReject(async () => {
    const res = await getPendingPlayProposal(chatSessionId, throwingDb);
    // 폴백 캐시가 살아있으면 정상 proposal, 없으면 null
    assert.ok(res === null || res.chatSessionId === chatSessionId);
  }, "DB 오류 시 getPendingPlayProposal이 예외를 throw하면 안 됨");

  // 3. DB 예외 상황에서 clearPendingPlayProposal 호출 시 throw하지 않음
  await assert.doesNotReject(async () => {
    await clearPendingPlayProposal(chatSessionId, throwingDb);
  }, "DB 오류 시 clearPendingPlayProposal이 예외를 throw하면 안 됨");
});

// Test 13: TTL (10분) 만료 검증
test("Test 13: TTL(10분) 초과 시 제안이 만료되어 null을 반환하고 DB에서 정리되는지 검증", async () => {
  const chatSessionId = "chat-ttl-session-13";
  let dbStoredProposal: any = null;

  const mockDbWithStorage = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { pending_play_proposal: dbStoredProposal },
            error: null,
          }),
        }),
      }),
      update: (payload: any) => ({
        eq: async () => {
          dbStoredProposal = payload.pending_play_proposal;
          return { error: null };
        },
      }),
    }),
  } as unknown as SupabaseClient;

  // 11분 전 시각
  const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;

  await setPendingPlayProposal(
    {
      chatSessionId,
      childId: "child-1",
      offeredSkills: ["CHOSUNG"],
      proposedAt: elevenMinutesAgo,
      initiatedBy: "k",
    },
    mockDbWithStorage
  );

  // 10분이 지났으므로 null 반환 및 DB 정리
  const result = await getPendingPlayProposal(chatSessionId, mockDbWithStorage);
  assert.equal(result, null, "10분이 지난 제안은 만료되어 null을 반환해야 함");
  assert.equal(dbStoredProposal, null, "만료된 제안은 DB에서도 null로 정리되어야 함");
});

// ============================================================================
// 007 리뷰 지적 반영 테스트 (필수 6종)
// ============================================================================

// Review Test 1: DB가 null을 반환하면 인메모리에 값이 있어도 null (부활 방지)
test("Review Test 1: DB가 null을 반환하면 인메모리에 값이 있어도 null (부활 방지)", async () => {
  const chatSessionId = "chat-review-test-1";
  const proposal = {
    chatSessionId,
    childId: "child-1",
    offeredSkills: ["CHOSUNG" as const],
    proposedAt: Date.now(),
    initiatedBy: "k" as const,
  };

  // 인메모리에 제안이 남아있음
  await setPendingPlayProposal(proposal);

  // DB 조회가 성공했고 결과가 null (다른 인스턴스에서 이미 정리됨)
  const mockDbWithNull = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { child_id: "child-1", turn_count: 1, pending_play_proposal: null },
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;

  const result = await getPendingPlayProposal(chatSessionId, mockDbWithNull);
  assert.equal(result, null, "DB가 null이면 인메모리에 값이 있어도 null을 반환해야 함");

  // 인메모리 캐시도 함께 삭제되었는지 확인
  const memResult = await getPendingPlayProposal(chatSessionId);
  assert.equal(memResult, null, "인메모리 캐시도 정리되어야 함");
});

// Review Test 2: DB 조회가 에러면 인메모리 폴백이 동작
test("Review Test 2: DB 조회가 에러면 인메모리 폴백이 동작", async () => {
  const chatSessionId = "chat-review-test-2";
  const proposal = {
    chatSessionId,
    childId: "child-1",
    offeredSkills: ["CHOSUNG" as const],
    proposedAt: Date.now(),
    initiatedBy: "k" as const,
  };

  // 인메모리에 제안 저장
  await setPendingPlayProposal(proposal);

  // DB 조회가 에러를 반환하는 경우
  const mockDbWithError = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: null,
            error: new Error("DB Query Error"),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;

  const result = await getPendingPlayProposal(chatSessionId, mockDbWithError);
  assert.ok(result, "DB 에러 시 인메모리 폴백에서 제안을 가져와야 함");
  assert.equal(result?.chatSessionId, chatSessionId);
  assert.deepEqual(result?.offeredSkills, ["CHOSUNG"]);
});

// Review Test 3: 제안 → 무관한 대화 1턴 → "응" → 게임이 시작되지 않는다 (위 사고 시나리오)
test("Review Test 3: 제안 → 무관한 대화 1턴('숙제 다 했어') → '응' → 게임이 시작되지 않는다 (사고 방지)", async () => {
  let chosungStartCalled = false;

  const mockChosungSkill: PlaySkillModule = {
    id: "CHOSUNG",
    displayName: "초성게임",
    childFacingDescription: "초성 맞히기",
    proposal: { label: "초성게임", shortDescription: "초성 퀴즈" },
    matchesDirectRequest: (signals) => Boolean(signals.hasChosungGameStart),
    getActiveSession: async () => null,
    start: async () => {
      chosungStartCalled = true;
      return { handled: true, instruction: "[초성게임] 문제" };
    },
    handleTurn: async () => ({ handled: true }),
    end: async () => {},
  };

  const chatSessionId = "chat-review-test-3";
  const db = createMockDb();

  // K: "초성게임 할래?" 제안 저장
  await setPendingPlayProposal({
    chatSessionId,
    childId: "child-1",
    offeredSkills: ["CHOSUNG"],
    proposedAt: Date.now(),
    initiatedBy: "k",
  }, db);

  // 1턴: 아이가 놀이와 무관한 "숙제 다 했어" 발화
  const turn1Signals = extractUtteranceSignals("숙제 다 했어");
  assert.equal(turn1Signals.hasGenericPlayAcceptance, false);

  const turn1Result = await routePlaySkillTurn({
    db,
    childId: "child-1",
    chatSessionId,
    gradeRaw: 3,
    utterance: "숙제 다 했어",
    signals: turn1Signals,
    registry: [mockChosungSkill],
  });

  assert.equal(turn1Result.handled, false);
  assert.equal(chosungStartCalled, false);

  // 1턴에서 수락/선택/거절이 없었으므로 제안 정리됨
  const pendingAfterTurn1 = await getPendingPlayProposal(chatSessionId, db);
  assert.equal(pendingAfterTurn1, null, "무관한 대화 이후 제안은 만료/정리되어야 함");

  // 2턴: K가 "대단해, 힘들었지?" 응답 후 아이가 "응" 발화
  const turn2Signals = extractUtteranceSignals("응");
  assert.equal(turn2Signals.hasGenericPlayAcceptance, true);

  const turn2Result = await routePlaySkillTurn({
    db,
    childId: "child-1",
    chatSessionId,
    gradeRaw: 3,
    utterance: "응",
    signals: turn2Signals,
    registry: [mockChosungSkill],
  });

  assert.equal(chosungStartCalled, false, "이전 턴 제안이 만료되었으므로 '응'에 게임이 시작되면 안 됨 (사고 방지)");
  assert.equal(turn2Result.handled, false);
});

// Review Test 4: 제안 → 바로 다음 턴 "응" → 정상 시작
test("Review Test 4: 제안 → 바로 다음 턴 '응' → 정상 시작", async () => {
  let chosungStartCalled = false;

  const mockChosungSkill: PlaySkillModule = {
    id: "CHOSUNG",
    displayName: "초성게임",
    childFacingDescription: "초성 맞히기",
    proposal: { label: "초성게임", shortDescription: "초성 퀴즈" },
    matchesDirectRequest: (signals) => Boolean(signals.hasChosungGameStart),
    getActiveSession: async () => null,
    start: async () => {
      chosungStartCalled = true;
      return { handled: true, instruction: "[초성게임] 첫 문제" };
    },
    handleTurn: async () => ({ handled: true }),
    end: async () => {},
  };

  const chatSessionId = "chat-review-test-4";
  const db = createMockDb();

  await setPendingPlayProposal({
    chatSessionId,
    childId: "child-1",
    offeredSkills: ["CHOSUNG"],
    proposedAt: Date.now(),
    initiatedBy: "k",
  }, db);

  const signals = extractUtteranceSignals("응");
  const result = await routePlaySkillTurn({
    db,
    childId: "child-1",
    chatSessionId,
    gradeRaw: 3,
    utterance: "응",
    signals,
    registry: [mockChosungSkill],
  });

  assert.equal(chosungStartCalled, true, "바로 다음 턴 '응'은 정상 시작되어야 함");
  assert.equal(result.handled, true);
  assert.equal(result.instruction, "[초성게임] 첫 문제");
  assert.equal(await getPendingPlayProposal(chatSessionId, db), null);
});

// Review Test 5: 되묻기 상태에서의 수명 (되묻기 직후 1턴 유효, 무관 대화 시 만료)
test("Review Test 5: 되묻기(selectionRequired) 상태에서의 수명 검증", async () => {
  let chosungStartCalled = false;

  const mockChosungSkill: PlaySkillModule = {
    id: "CHOSUNG",
    displayName: "초성게임",
    childFacingDescription: "초성 맞히기",
    proposal: { label: "초성게임", shortDescription: "초성 퀴즈" },
    matchesDirectRequest: (signals, utterance) => utterance.includes("초성"),
    getActiveSession: async () => null,
    start: async () => {
      chosungStartCalled = true;
      return { handled: true, instruction: "[초성게임] 시작" };
    },
    handleTurn: async () => ({ handled: true }),
    end: async () => {},
  };

  const mockWordChainSkill: PlaySkillModule = {
    id: "WORD_CHAIN",
    displayName: "끝말잇기",
    childFacingDescription: "끝말 잇기",
    proposal: { label: "끝말잇기", shortDescription: "단어 잇기" },
    matchesDirectRequest: (signals, utterance) => utterance.includes("끝말"),
    getActiveSession: async () => null,
    start: async () => ({ handled: true }),
    handleTurn: async () => ({ handled: true }),
    end: async () => {},
  };

  const chatSessionId = "chat-review-test-5";
  const db = createMockDb();

  // 1. 복수 제안
  await setPendingPlayProposal({
    chatSessionId,
    childId: "child-1",
    offeredSkills: ["CHOSUNG", "WORD_CHAIN"],
    proposedAt: Date.now(),
    initiatedBy: "k",
  }, db);

  // 2. 포괄 수락("좋아") -> 되묻기 상태 (selectionRequired: true)
  const turn1Result = await routePlaySkillTurn({
    db,
    childId: "child-1",
    chatSessionId,
    gradeRaw: 3,
    utterance: "좋아",
    signals: extractUtteranceSignals("좋아"),
    registry: [mockChosungSkill, mockWordChainSkill],
  });
  assert.equal(turn1Result.handled, true);
  const pending = await getPendingPlayProposal(chatSessionId, db);
  assert.equal(pending?.selectionRequired, true);

  // 3. 되묻기 직후 아이가 선택 대신 무관한 발화("피자 먹고 싶다")를 함
  const turn2Result = await routePlaySkillTurn({
    db,
    childId: "child-1",
    chatSessionId,
    gradeRaw: 3,
    utterance: "피자 먹고 싶다",
    signals: extractUtteranceSignals("피자 먹고 싶다"),
    registry: [mockChosungSkill, mockWordChainSkill],
  });
  assert.equal(turn2Result.handled, false);

  // 되묻기 후에도 무관한 대화로 넘어가면 제안이 정리되어야 함
  assert.equal(await getPendingPlayProposal(chatSessionId, db), null);

  // 4. 다음 턴에 "응" 발화 시 게임이 시작되지 않음
  const turn3Result = await routePlaySkillTurn({
    db,
    childId: "child-1",
    chatSessionId,
    gradeRaw: 3,
    utterance: "응",
    signals: extractUtteranceSignals("응"),
    registry: [mockChosungSkill, mockWordChainSkill],
  });
  assert.equal(chosungStartCalled, false);
  assert.equal(turn3Result.handled, false);
});

// Review Test 6: 다른 childId로 조회하면 null (방어적 확인)
test("Review Test 6: 다른 childId로 조회하면 null (방어적 확인)", async () => {
  const chatSessionId = "chat-review-test-6";
  const db = createMockDb({
    child_id: "child-1",
    pending_play_proposal: {
      chatSessionId,
      childId: "child-1",
      offeredSkills: ["CHOSUNG"],
      proposedAt: Date.now(),
      initiatedBy: "k",
    },
    turn_count: 1,
  });

  // 올바른 childId로 조회
  const valid = await getPendingPlayProposal(chatSessionId, db, "child-1");
  assert.ok(valid);
  assert.equal(valid?.childId, "child-1");

  // 다른 childId로 조회 -> null
  const mismatched = await getPendingPlayProposal(chatSessionId, db, "child-2");
  assert.equal(mismatched, null, "childId가 다르면 null을 반환해야 함");

  // 인메모리 조회에서도 다른 childId면 null
  clearAllPendingProposalsForTest();
  await setPendingPlayProposal({
    chatSessionId,
    childId: "child-1",
    offeredSkills: ["CHOSUNG"],
    proposedAt: Date.now(),
    initiatedBy: "k",
  });
  const memMismatched = await getPendingPlayProposal(chatSessionId, null, "child-2");
  assert.equal(memMismatched, null, "인메모리에서도 childId가 다르면 null이어야 함");
});
