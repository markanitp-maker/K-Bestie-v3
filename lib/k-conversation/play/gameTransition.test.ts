import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UtteranceSignals } from "../utteranceSignals";
import { extractUtteranceSignals } from "../utteranceSignals";
import type { PlaySkillModule } from "./skillTypes";
import { PLAY_SKILL_REGISTRY } from "./skillRegistry";
import { routePlaySkillTurn } from "./skillRouter";

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
};

function createMockDb(): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    update: () => chain,
    insert: () => chain,
  };
  return {
    from: () => chain,
  } as unknown as SupabaseClient;
}

test("사고 재현 & Invariant 2: CHOSUNG 활성 중 '끝말잇기하자' → CHOSUNG이 end되고 WORD_CHAIN이 start된다", async () => {
  let chosungEnded = false;
  let wordChainStarted = false;

  const mockChosungSkill: PlaySkillModule = {
    id: "CHOSUNG",
    proposal: { label: "초성", shortDescription: "초성게임" },
    matchesDirectRequest: (signals) => Boolean(signals.hasChosungGameStart),
    getActiveSession: async () => ({ id: "active-chosung-session" }),
    start: async () => ({ handled: true, instruction: "chosung-start" }),
    handleTurn: async () => ({ handled: true, instruction: "chosung-turn" }),
    end: async () => {
      chosungEnded = true;
    },
  };

  const mockWordChainSkill: PlaySkillModule = {
    id: "WORD_CHAIN",
    proposal: { label: "끝말잇기", shortDescription: "끝말잇기" },
    matchesDirectRequest: (signals, utterance) =>
      Boolean(signals.hasWordChainGameStart) || utterance.includes("끝말잇기"),
    getActiveSession: async () => null,
    start: async () => {
      wordChainStarted = true;
      return { handled: true, instruction: "word-chain-start" };
    },
    handleTurn: async () => ({ handled: true, instruction: "word-chain-turn" }),
    end: async () => {},
  };

  const signals = extractUtteranceSignals("끝말잇기하자");
  const result = await routePlaySkillTurn({
    db: createMockDb(),
    childId: "child-seoah",
    chatSessionId: "chat-1",
    gradeRaw: 3,
    utterance: "끝말잇기하자",
    signals,
    registry: [mockChosungSkill, mockWordChainSkill],
  });

  assert.equal(chosungEnded, true, "기존 CHOSUNG 세션이 종료(end)되어야 함");
  assert.equal(wordChainStarted, true, "요청된 WORD_CHAIN 세션이 시작(start)되어야 함");
  assert.equal(result.handled, true);
  assert.equal(result.instruction, "word-chain-start");
});

test("Invariant 1: 전환 후 활성 게임이 정확히 1개다", async () => {
  let activeGame: string | null = "CHOSUNG";

  const dynamicChosung: PlaySkillModule = {
    id: "CHOSUNG",
    proposal: { label: "초성", shortDescription: "초성" },
    matchesDirectRequest: (signals) => Boolean(signals.hasChosungGameStart),
    getActiveSession: async () => (activeGame === "CHOSUNG" ? { id: "cs-1" } : null),
    start: async () => {
      activeGame = "CHOSUNG";
      return { handled: true, instruction: "cs-start" };
    },
    handleTurn: async () => ({ handled: true, instruction: "cs-turn" }),
    end: async () => {
      if (activeGame === "CHOSUNG") activeGame = null;
    },
  };

  const dynamicWordChain: PlaySkillModule = {
    id: "WORD_CHAIN",
    proposal: { label: "끝말잇기", shortDescription: "끝말잇기" },
    matchesDirectRequest: (signals, utterance) =>
      Boolean(signals.hasWordChainGameStart) || utterance.includes("끝말잇기"),
    getActiveSession: async () => (activeGame === "WORD_CHAIN" ? { id: "wc-1" } : null),
    start: async () => {
      activeGame = "WORD_CHAIN";
      return { handled: true, instruction: "wc-start" };
    },
    handleTurn: async () => ({ handled: true, instruction: "wc-turn" }),
    end: async () => {
      if (activeGame === "WORD_CHAIN") activeGame = null;
    },
  };

  const registry = [dynamicChosung, dynamicWordChain];
  const db = createMockDb();

  // 전환 전: CHOSUNG 1개 활성
  assert.equal((await dynamicChosung.getActiveSession(db, "child-1")) !== null, true);
  assert.equal((await dynamicWordChain.getActiveSession(db, "child-1")) !== null, false);

  // 전환 실행
  const signals = extractUtteranceSignals("끝말잇기하자");
  await routePlaySkillTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 3,
    utterance: "끝말잇기하자",
    signals,
    registry,
  });

  // 전환 후: WORD_CHAIN 1개만 활성 (정확히 1개)
  const chosungActive = await dynamicChosung.getActiveSession(db, "child-1");
  const wordChainActive = await dynamicWordChain.getActiveSession(db, "child-1");

  assert.equal(chosungActive, null, "CHOSUNG 세션은 종료되어 활성이 아니어야 함");
  assert.notEqual(wordChainActive, null, "WORD_CHAIN 세션이 활성화되어야 함");
  assert.equal(activeGame, "WORD_CHAIN");
});

test("Invariant 2: CHOSUNG 활성 중 '초성게임 하자'(같은 게임) → 기존 판이 유지된다(end 안 됨)", async () => {
  let endCalled = false;
  let handleTurnCalled = false;
  let startCalled = false;

  const mockChosungSkill: PlaySkillModule = {
    id: "CHOSUNG",
    proposal: { label: "초성", shortDescription: "초성게임" },
    matchesDirectRequest: (signals) => Boolean(signals.hasChosungGameStart),
    getActiveSession: async () => ({ id: "active-chosung-session" }),
    start: async () => {
      startCalled = true;
      return { handled: true, instruction: "start-new-board" };
    },
    handleTurn: async () => {
      handleTurnCalled = true;
      return { handled: true, instruction: "continue-existing-board" };
    },
    end: async () => {
      endCalled = true;
    },
  };

  const signals = extractUtteranceSignals("초성게임 하자");
  const result = await routePlaySkillTurn({
    db: createMockDb(),
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 3,
    utterance: "초성게임 하자",
    signals,
    registry: [mockChosungSkill],
  });

  assert.equal(endCalled, false, "같은 게임 재요청 시 end는 호출되지 않아야 함");
  assert.equal(startCalled, false, "같은 게임 재요청 시 새 게임 start는 호출되지 않아야 함");
  assert.equal(handleTurnCalled, true, "기존 세션의 handleTurn이 호출되어 판이 유지되어야 함");
  assert.equal(result.handled, true);
  assert.equal(result.instruction, "continue-existing-board");
});

test("Invariant 4: WORD_CHAIN 활성 중 일반 단어 입력('스위스')이 CHOSUNG으로 라우팅되지 않는다", async () => {
  let chosungTurnCalled = false;
  let wordChainTurnCalled = false;

  const mockChosungSkill: PlaySkillModule = {
    id: "CHOSUNG",
    proposal: { label: "초성", shortDescription: "초성" },
    matchesDirectRequest: (signals) => Boolean(signals.hasChosungGameStart),
    getActiveSession: async () => null,
    start: async () => ({ handled: true }),
    handleTurn: async () => {
      chosungTurnCalled = true;
      return { handled: true, instruction: "chosung-wrong" };
    },
    end: async () => {},
  };

  const mockWordChainSkill: PlaySkillModule = {
    id: "WORD_CHAIN",
    proposal: { label: "끝말잇기", shortDescription: "끝말잇기" },
    matchesDirectRequest: (signals, utterance) =>
      Boolean(signals.hasWordChainGameStart) || utterance.includes("끝말잇기"),
    getActiveSession: async () => ({ id: "active-wc-session" }),
    start: async () => ({ handled: true }),
    handleTurn: async () => {
      wordChainTurnCalled = true;
      return { handled: true, instruction: "word-chain-accept-swiss" };
    },
    end: async () => {},
  };

  const signals = extractUtteranceSignals("스위스");
  const result = await routePlaySkillTurn({
    db: createMockDb(),
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 3,
    utterance: "스위스",
    signals,
    registry: [mockChosungSkill, mockWordChainSkill],
  });

  assert.equal(chosungTurnCalled, false, "CHOSUNG handleTurn이 호출되면 안 됨");
  assert.equal(wordChainTurnCalled, true, "WORD_CHAIN handleTurn이 호출되어야 함");
  assert.equal(result.handled, true);
  assert.equal(result.instruction, "word-chain-accept-swiss");
});

test("Invariant 4: CHOSUNG 활성 중 일반 단어 입력('사과')이 WORD_CHAIN으로 라우팅되지 않는다", async () => {
  let chosungTurnCalled = false;
  let wordChainTurnCalled = false;

  const mockChosungSkill: PlaySkillModule = {
    id: "CHOSUNG",
    proposal: { label: "초성", shortDescription: "초성" },
    matchesDirectRequest: (signals) => Boolean(signals.hasChosungGameStart),
    getActiveSession: async () => ({ id: "active-cs-session" }),
    start: async () => ({ handled: true }),
    handleTurn: async () => {
      chosungTurnCalled = true;
      return { handled: true, instruction: "chosung-correct-apple" };
    },
    end: async () => {},
  };

  const mockWordChainSkill: PlaySkillModule = {
    id: "WORD_CHAIN",
    proposal: { label: "끝말잇기", shortDescription: "끝말잇기" },
    matchesDirectRequest: (signals, utterance) =>
      Boolean(signals.hasWordChainGameStart) || utterance.includes("끝말잇기"),
    getActiveSession: async () => null,
    start: async () => ({ handled: true }),
    handleTurn: async () => {
      wordChainTurnCalled = true;
      return { handled: true, instruction: "word-chain-turn" };
    },
    end: async () => {},
  };

  const signals = extractUtteranceSignals("사과");
  const result = await routePlaySkillTurn({
    db: createMockDb(),
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 3,
    utterance: "사과",
    signals,
    registry: [mockChosungSkill, mockWordChainSkill],
  });

  assert.equal(wordChainTurnCalled, false, "WORD_CHAIN handleTurn이 호출되면 안 됨");
  assert.equal(chosungTurnCalled, true, "CHOSUNG handleTurn이 호출되어야 함");
  assert.equal(result.handled, true);
  assert.equal(result.instruction, "chosung-correct-apple");
});

test("원자적 전환: end가 실패하면 start하지 않고 기존 게임이 유지된다", async () => {
  let wordChainStartCalled = false;
  let chosungTurnCalled = false;
  const errorsLogged: string[] = [];

  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    errorsLogged.push(args.map(String).join(" "));
  };

  try {
    const mockFailingChosungSkill: PlaySkillModule = {
      id: "CHOSUNG",
      proposal: { label: "초성", shortDescription: "초성" },
      matchesDirectRequest: (signals) => Boolean(signals.hasChosungGameStart),
      getActiveSession: async () => ({ id: "active-cs" }),
      start: async () => ({ handled: true }),
      handleTurn: async () => {
        chosungTurnCalled = true;
        return { handled: true, instruction: "chosung-maintained" };
      },
      end: async () => {
        throw new Error("DB transaction failure on end");
      },
    };

    const mockWordChainSkill: PlaySkillModule = {
      id: "WORD_CHAIN",
      proposal: { label: "끝말잇기", shortDescription: "끝말잇기" },
      matchesDirectRequest: (signals, utterance) =>
        Boolean(signals.hasWordChainGameStart) || utterance.includes("끝말잇기"),
      getActiveSession: async () => null,
      start: async () => {
        wordChainStartCalled = true;
        return { handled: true, instruction: "wc-start" };
      },
      handleTurn: async () => ({ handled: true }),
      end: async () => {},
    };

    const signals = extractUtteranceSignals("끝말잇기하자");
    const result = await routePlaySkillTurn({
      db: createMockDb(),
      childId: "child-1",
      chatSessionId: "chat-1",
      gradeRaw: 3,
      utterance: "끝말잇기하자",
      signals,
      registry: [mockFailingChosungSkill, mockWordChainSkill],
    });

    assert.equal(wordChainStartCalled, false, "end 실패 시 새 게임 start는 호출되지 않아야 함");
    assert.equal(chosungTurnCalled, true, "end 실패 시 기존 게임의 handleTurn으로 유지되어야 함");
    assert.equal(result.handled, true);
    assert.equal(result.instruction, "chosung-maintained");
    assert.ok(
      errorsLogged.some((log) => log.includes("Failed to end active skill")),
      "end 실패 에러 로그가 기록되어야 함"
    );
  } finally {
    console.error = originalConsoleError;
  }
});

test("Invariant 3: '그만할래'/'안 할래'/'그만하자' → 활성 게임 종료 후 handled=false", async () => {
  const stopUtterances = ["그만할래", "안 할래", "그만하자", "그만해", "안해", "그만"];

  for (const text of stopUtterances) {
    let endCalled = false;

    const mockActiveSkill: PlaySkillModule = {
      id: "CHOSUNG",
      proposal: { label: "초성", shortDescription: "초성" },
      matchesDirectRequest: () => false,
      getActiveSession: async () => ({ id: "active-cs" }),
      start: async () => ({ handled: true }),
      handleTurn: async () => ({ handled: true, instruction: "should-not-reach" }),
      end: async () => {
        endCalled = true;
      },
    };

    const signals = extractUtteranceSignals(text);
    const result = await routePlaySkillTurn({
      db: createMockDb(),
      childId: "child-1",
      chatSessionId: "chat-1",
      gradeRaw: 3,
      utterance: text,
      signals,
      registry: [mockActiveSkill],
    });

    assert.equal(endCalled, true, `"${text}" 발화 시 활성 게임이 end 되어야 함`);
    assert.deepEqual(result, { handled: false }, `"${text}" 발화 시 handled: false 반환되어 일반 대화로 복귀해야 함`);
  }
});

test("Invariant 3: 직접 요청이 없으면 기존처럼 활성 세션이 처리한다 (stickiness)", async () => {
  let activeTurnCalled = false;

  const mockActiveSkill: PlaySkillModule = {
    id: "CHOSUNG",
    proposal: { label: "초성", shortDescription: "초성" },
    matchesDirectRequest: () => false,
    getActiveSession: async () => ({ id: "active-cs" }),
    start: async () => ({ handled: true }),
    handleTurn: async (input) => {
      activeTurnCalled = true;
      return { handled: true, instruction: `chosung-processed-${input.utterance}` };
    },
    end: async () => {},
  };

  const signals = extractUtteranceSignals("사자");
  const result = await routePlaySkillTurn({
    db: createMockDb(),
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 3,
    utterance: "사자",
    signals,
    registry: [mockActiveSkill],
  });

  assert.equal(activeTurnCalled, true, "직접 요청 없는 일반 입력은 활성 세션이 처리해야 함");
  assert.equal(result.handled, true);
  assert.equal(result.instruction, "chosung-processed-사자");
});
