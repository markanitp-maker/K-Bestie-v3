import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UtteranceSignals } from "../utteranceSignals";
import type {
  PlaySkillModule,
  PlaySkillStartInput,
  PlaySkillTurnInput,
  PlaySkillEndInput,
  PlaySkillTurnResult,
} from "./skillTypes";
import { PLAY_SKILL_REGISTRY, findSkillById, findDirectlyRequestedSkill } from "./skillRegistry";
import { CHOSUNG_SKILL } from "./chosungSkill";
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
    single: () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    update: () => chain,
    insert: () => chain,
  };
  return {
    from: () => chain,
  } as unknown as SupabaseClient;
}

test("SkillRegistry: 기본 등록된 Skill 목록 및 조회 함수 검증", () => {
  assert.equal(PLAY_SKILL_REGISTRY.length, 2);
  assert.equal(PLAY_SKILL_REGISTRY[0].id, "CHOSUNG");
  assert.equal(PLAY_SKILL_REGISTRY[1].id, "WORD_CHAIN");

  // findSkillById
  const chosung = findSkillById("CHOSUNG");
  assert.ok(chosung);
  assert.equal(chosung?.id, "CHOSUNG");

  const wordChain = findSkillById("WORD_CHAIN");
  assert.ok(wordChain);
  assert.equal(wordChain?.id, "WORD_CHAIN");

  const nonExistent = findSkillById("TWENTY_QUESTIONS" as any);
  assert.equal(nonExistent, null);

  // findDirectlyRequestedSkill
  const chosungSignals: UtteranceSignals = {
    ...defaultSignals,
    hasChosungGameStart: true,
  };
  const matched = findDirectlyRequestedSkill(chosungSignals, "초성게임 하자");
  assert.ok(matched);
  assert.equal(matched?.id, "CHOSUNG");

  const wordChainMatched = findDirectlyRequestedSkill(defaultSignals, "끝말잇기 하자");
  assert.ok(wordChainMatched);
  assert.equal(wordChainMatched?.id, "WORD_CHAIN");

  const unmatched = findDirectlyRequestedSkill(defaultSignals, "오늘 날씨 어때?");
  assert.equal(unmatched, null);
});

test("CHOSUNG_SKILL Adapter: 인터페이스 계약 및 기본 속성 검증", async () => {
  assert.equal(CHOSUNG_SKILL.id, "CHOSUNG");
  assert.ok(CHOSUNG_SKILL.proposal.label.includes("초성"));
  assert.ok(CHOSUNG_SKILL.proposal.shortDescription.length > 0);

  // matchesDirectRequest
  assert.equal(
    CHOSUNG_SKILL.matchesDirectRequest(
      { ...defaultSignals, hasChosungGameStart: true },
      "초성게임 하자"
    ),
    true
  );
  assert.equal(
    CHOSUNG_SKILL.matchesDirectRequest(defaultSignals, "안녕"),
    false
  );
});

test("SkillRouter: 활성 세션이 있으면 직접 요청보다 활성 세션이 우선한다", async () => {
  let activeTurnCalled = false;
  let startCalled = false;

  const mockActiveSkill: PlaySkillModule = {
    id: "CHOSUNG",
    proposal: { label: "초성", shortDescription: "설명" },
    matchesDirectRequest: () => false,
    getActiveSession: async () => ({ id: "active-session-123" }),
    start: async () => {
      startCalled = true;
      return { handled: true, instruction: "start-instruction" };
    },
    handleTurn: async () => {
      activeTurnCalled = true;
      return { handled: true, instruction: "active-turn-instruction" };
    },
    end: async () => {},
  };

  const mockDirectRequestedSkill: PlaySkillModule = {
    id: "WORD_CHAIN",
    proposal: { label: "끝말잇기", shortDescription: "설명" },
    matchesDirectRequest: () => true, // 직접 요청 매칭
    getActiveSession: async () => null,
    start: async () => {
      startCalled = true;
      return { handled: true, instruction: "word-chain-start" };
    },
    handleTurn: async () => ({ handled: false }),
    end: async () => {},
  };

  const result = await routePlaySkillTurn({
    db: createMockDb(),
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 3,
    utterance: "끝말잇기 하자",
    signals: { ...defaultSignals },
    registry: [mockActiveSkill, mockDirectRequestedSkill],
  });

  assert.equal(activeTurnCalled, true, "활성 세션의 handleTurn이 호출되어야 함");
  assert.equal(startCalled, false, "직접 요청의 start는 호출되지 않아야 함");
  assert.equal(result.handled, true);
  assert.equal(result.instruction, "active-turn-instruction");
});

test("SkillRouter: 활성 세션이 없고 직접 요청이 있으면 start가 불린다", async () => {
  let startCalled = false;

  const mockSkill: PlaySkillModule = {
    id: "CHOSUNG",
    proposal: { label: "초성", shortDescription: "설명" },
    matchesDirectRequest: (_signals, utterance) => utterance.includes("초성"),
    getActiveSession: async () => null,
    start: async (input) => {
      startCalled = true;
      return {
        handled: true,
        instruction: `초성문제 시작: ${input.utterance}`,
      };
    },
    handleTurn: async () => ({ handled: false }),
    end: async () => {},
  };

  const result = await routePlaySkillTurn({
    db: createMockDb(),
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "초성게임 하자",
    signals: { ...defaultSignals, hasChosungGameStart: true },
    registry: [mockSkill],
  });

  assert.equal(startCalled, true, "start 함수가 호출되어야 함");
  assert.equal(result.handled, true);
  assert.equal(result.instruction, "초성문제 시작: 초성게임 하자");
});

test("SkillRouter: 활성 세션도 없고 직접 요청도 없으면 handled=false 반환", async () => {
  const mockSkill: PlaySkillModule = {
    id: "CHOSUNG",
    proposal: { label: "초성", shortDescription: "설명" },
    matchesDirectRequest: () => false,
    getActiveSession: async () => null,
    start: async () => ({ handled: true }),
    handleTurn: async () => ({ handled: true }),
    end: async () => {},
  };

  const result = await routePlaySkillTurn({
    db: createMockDb(),
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 1,
    utterance: "오늘 학교에서 밥 맛있었어",
    signals: defaultSignals,
    registry: [mockSkill],
  });

  assert.deepEqual(result, { handled: false });
});

test("SkillRouter: Skill 실행 중 예외가 발생해도 Router가 fail-open({ handled: false })으로 격리한다", async () => {
  // 1. getActiveSession 예외 던질 때
  const throwingActiveSkill: PlaySkillModule = {
    id: "CHOSUNG",
    proposal: { label: "초성", shortDescription: "설명" },
    matchesDirectRequest: () => false,
    getActiveSession: async () => {
      throw new Error("DB connection drop");
    },
    start: async () => ({ handled: true }),
    handleTurn: async () => ({ handled: true }),
    end: async () => {},
  };

  const res1 = await routePlaySkillTurn({
    db: createMockDb(),
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 1,
    utterance: "테스트",
    signals: defaultSignals,
    registry: [throwingActiveSkill],
  });
  assert.deepEqual(res1, { handled: false });

  // 2. handleTurn 예외 던질 때
  const throwingTurnSkill: PlaySkillModule = {
    id: "CHOSUNG",
    proposal: { label: "초성", shortDescription: "설명" },
    matchesDirectRequest: () => false,
    getActiveSession: async () => ({ id: "session-1" }),
    start: async () => ({ handled: true }),
    handleTurn: async () => {
      throw new Error("Internal turn execution crash");
    },
    end: async () => {},
  };

  const res2 = await routePlaySkillTurn({
    db: createMockDb(),
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 1,
    utterance: "사과",
    signals: defaultSignals,
    registry: [throwingTurnSkill],
  });
  assert.deepEqual(res2, { handled: false });

  // 3. start 예외 던질 때
  const throwingStartSkill: PlaySkillModule = {
    id: "CHOSUNG",
    proposal: { label: "초성", shortDescription: "설명" },
    matchesDirectRequest: () => true,
    getActiveSession: async () => null,
    start: async () => {
      throw new Error("Start session failure");
    },
    handleTurn: async () => ({ handled: true }),
    end: async () => {},
  };

  const res3 = await routePlaySkillTurn({
    db: createMockDb(),
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 1,
    utterance: "초성게임 시작",
    signals: defaultSignals,
    registry: [throwingStartSkill],
  });
  assert.deepEqual(res3, { handled: false });
});

test("SkillRouter Cross-game Guard: 활성 Skill이 2개 이상이면 에러 로그를 남기고 먼저 발견된 하나만 진행한다", async () => {
  const executedTurns: string[] = [];
  const errorsLogged: string[] = [];

  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    errorsLogged.push(args.map(String).join(" "));
  };

  try {
    const skillA: PlaySkillModule = {
      id: "CHOSUNG",
      proposal: { label: "초성", shortDescription: "설명" },
      matchesDirectRequest: () => false,
      getActiveSession: async () => ({ id: "chosung-session-1" }),
      start: async () => ({ handled: true }),
      handleTurn: async () => {
        executedTurns.push("CHOSUNG");
        return { handled: true, instruction: "chosung-turn" };
      },
      end: async () => {},
    };

    const skillB: PlaySkillModule = {
      id: "WORD_CHAIN",
      proposal: { label: "끝말잇기", shortDescription: "설명" },
      matchesDirectRequest: () => false,
      getActiveSession: async () => ({ id: "word-chain-session-2" }),
      start: async () => ({ handled: true }),
      handleTurn: async () => {
        executedTurns.push("WORD_CHAIN");
        return { handled: true, instruction: "word-chain-turn" };
      },
      end: async () => {},
    };

    const result = await routePlaySkillTurn({
      db: createMockDb(),
      childId: "child-multi",
      chatSessionId: "chat-1",
      gradeRaw: 3,
      utterance: "다음 턴",
      signals: defaultSignals,
      registry: [skillA, skillB],
    });

    assert.equal(result.handled, true);
    assert.equal(result.instruction, "chosung-turn");
    assert.deepEqual(executedTurns, ["CHOSUNG"], "첫 번째 활성 Skill만 진행되어야 함");
    assert.ok(
      errorsLogged.some((log) => log.includes("Cross-game active guard")),
      "Cross-game guard 에러 로그가 기록되어야 함"
    );
  } finally {
    console.error = originalConsoleError;
  }
});

test("SkillRouter 정적 분석: Router 소스코드에 게임 이름 하드코딩 분기가 없다", () => {
  const routerPath = path.resolve(__dirname, "skillRouter.ts");
  const routerContent = fs.readFileSync(routerPath, "utf-8");

  // Router 내부에는 특정 게임 id 분기 (예: "CHOSUNG", "WORD_CHAIN")가 하드코딩되어선 안 됨
  // (에러 로그 포맷팅이나 타입 주석 등 제외한 로직상 if (=== "CHOSUNG") 검사)
  assert.equal(
    /if\s*\([^)]*===?\s*["']CHOSUNG["']\)/i.test(routerContent),
    false,
    "Router 코드에 CHOSUNG if 분기가 없어야 함"
  );
  assert.equal(
    /if\s*\([^)]*===?\s*["']WORD_CHAIN["']\)/i.test(routerContent),
    false,
    "Router 코드에 WORD_CHAIN if 분기가 없어야 함"
  );
  assert.equal(
    /switch\s*\([^)]*id\)/i.test(routerContent),
    false,
    "Router 코드에 skill id switch 분기가 없어야 함"
  );
});

test("SkillRouter 확장성: Registry에 새로운 가짜 Skill을 추가해도 Router 코드 변경 없이 동작한다", async () => {
  const customSkill: PlaySkillModule = {
    id: "WORD_CHAIN",
    proposal: { label: "새로운 놀이", shortDescription: "임의의 신규 놀이 모듈" },
    matchesDirectRequest: (_signals, utterance) => utterance.includes("새놀이"),
    getActiveSession: async () => null,
    start: async (input) => ({
      handled: true,
      instruction: `새놀이 시작 완료: ${input.childId}`,
      ended: false,
    }),
    handleTurn: async () => ({ handled: true }),
    end: async () => {},
  };

  const customRegistry: readonly PlaySkillModule[] = [
    CHOSUNG_SKILL,
    customSkill,
  ];

  const result = await routePlaySkillTurn({
    db: createMockDb(),
    childId: "child-test",
    chatSessionId: "chat-123",
    gradeRaw: 4,
    utterance: "새놀이 시작하자",
    signals: defaultSignals,
    registry: customRegistry,
  });

  assert.equal(result.handled, true);
  assert.equal(result.instruction, "새놀이 시작 완료: child-test");
});
