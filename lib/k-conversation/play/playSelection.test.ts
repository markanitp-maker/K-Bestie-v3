import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaySkillModule, PlaySkillStartInput, PlaySkillTurnInput, PlaySkillEndInput, PlaySkillTurnResult } from "./skillTypes";
import { PLAY_SKILL_REGISTRY } from "./skillRegistry";
import {
  buildPlaySkillsCatalogDto,
  createEmptyUtteranceSignals,
  executeSkillSelection,
} from "./playSelection";

function createMockDb(): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: null, error: null }),
        }),
      }),
      update: () => ({
        eq: async () => ({ error: null }),
      }),
    }),
  } as unknown as SupabaseClient;
}

function createMockSkill(params: {
  id: string;
  displayName: string;
  childFacingDescription: string;
  activeSessionId?: string | null;
  startResult?: PlaySkillTurnResult;
  onStart?: (input: PlaySkillStartInput) => void;
  onEnd?: (input: PlaySkillEndInput) => void;
}): PlaySkillModule {
  let activeId = params.activeSessionId ?? null;

  return {
    id: params.id as any,
    displayName: params.displayName,
    childFacingDescription: params.childFacingDescription,
    proposal: {
      label: params.displayName,
      shortDescription: params.childFacingDescription,
    },
    matchesDirectRequest: () => false,
    getActiveSession: async () => (activeId ? { id: activeId } : null),
    start: async (input: PlaySkillStartInput) => {
      params.onStart?.(input);
      activeId = "session_" + params.id;
      return params.startResult ?? { handled: true, instruction: `[${params.displayName}] 시작 지침` };
    },
    handleTurn: async (_input: PlaySkillTurnInput) => ({ handled: true }),
    end: async (input: PlaySkillEndInput) => {
      params.onEnd?.(input);
      activeId = null;
    },
  };
}

test("buildPlaySkillsCatalogDto: 기본 PLAY_SKILL_REGISTRY 3종 DTO 변환 검증", () => {
  const result = buildPlaySkillsCatalogDto(PLAY_SKILL_REGISTRY, "WORD_CHAIN");

  assert.equal(result.skills.length, 3);
  assert.equal(result.activeSkillId, "WORD_CHAIN");

  const chosung = result.skills.find((s) => s.id === "CHOSUNG");
  assert.ok(chosung);
  assert.equal(chosung.name, "초성게임");
  assert.equal(chosung.description, "내가 초성을 주면 무슨 말인지 맞히는 놀이");
  assert.equal(chosung.available, true);

  const wordChain = result.skills.find((s) => s.id === "WORD_CHAIN");
  assert.ok(wordChain);
  assert.equal(wordChain.name, "끝말잇기");
  assert.equal(wordChain.description, "앞 말의 끝 글자로 이어서 말하는 놀이");
  assert.equal(wordChain.available, true);

  const nonsense = result.skills.find((s) => s.id === "NONSENSE_QUIZ");
  assert.ok(nonsense);
  assert.equal(nonsense.name, "넌센스 퀴즈");
  assert.equal(nonsense.description, "알쏭달쏭 재미있는 수수께끼를 맞히는 퀴즈 놀이");
  assert.equal(nonsense.available, true);
});

test("buildPlaySkillsCatalogDto: 새 스킬이 레지스트리에 추가되면 if/else 없이 자동 반영", () => {
  const customSkill = createMockSkill({
    id: "NEW_GAME",
    displayName: "새로운 놀이",
    childFacingDescription: "새로운 재미있는 놀이",
  });

  const customRegistry = [...PLAY_SKILL_REGISTRY, customSkill];
  const result = buildPlaySkillsCatalogDto(customRegistry, null);

  assert.equal(result.skills.length, 4);
  assert.equal(result.activeSkillId, null);

  const newGameDto = result.skills.find((s) => s.id === "NEW_GAME");
  assert.ok(newGameDto);
  assert.equal(newGameDto.name, "새로운 놀이");
  assert.equal(newGameDto.description, "새로운 재미있는 놀이");
  assert.equal(newGameDto.available, true);
});

test("createEmptyUtteranceSignals: 발화 없는 UI 선택용 신호 생성 (가짜 발화 미사용)", () => {
  const signals = createEmptyUtteranceSignals();
  assert.equal(signals.hasChosungGameStart, false);
  assert.equal(signals.hasWordChainGameStart, false);
  assert.equal(signals.hasNonsenseGameStart, false);
  assert.equal(signals.hasPlayStop, false);
  assert.equal(signals.hasPlayRejection, false);
  assert.equal(signals.hasGenericPlayAcceptance, false);
  assert.equal(signals.hasAchievement, false);
  assert.equal(signals.hasConflict, false);
  assert.equal(signals.hasNegativeEmotion, false);
});

test("executeSkillSelection: 존재하지 않는 skillId 요청 시 실패 응답", async () => {
  const db = createMockDb();
  const result = await executeSkillSelection({
    db,
    childId: "child_123",
    chatSessionId: "chat_456",
    skillId: "INVALID_SKILL_XYZ",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "Invalid skillId");
});

test("executeSkillSelection: 같은 스킬이 이미 활성이면 중복 생성 없이 기존 세션 재개", async () => {
  const db = createMockDb();
  let startCalled = false;

  const wordChainSkill = createMockSkill({
    id: "WORD_CHAIN",
    displayName: "끝말잇기",
    childFacingDescription: "끝말잇기 설명",
    activeSessionId: "existing_session_word_chain_123",
    onStart: () => {
      startCalled = true;
    },
  });

  const result = await executeSkillSelection({
    db,
    childId: "child_123",
    chatSessionId: "chat_456",
    skillId: "WORD_CHAIN",
    registry: [wordChainSkill],
  });

  assert.equal(result.ok, true);
  assert.equal(result.resumed, true);
  assert.equal(result.skillId, "WORD_CHAIN");
  assert.equal(result.sessionId, "existing_session_word_chain_123");
  assert.equal(startCalled, false, "이미 활성인 스킬은 start를 다시 호출하지 않아야 함");
});

test("executeSkillSelection: 다른 스킬이 활성이면 기존 스킬 end() 후 새 스킬 start()", async () => {
  const db = createMockDb();
  let chosungEnded = false;
  let wordChainStarted = false;
  let receivedUtterance = "INITIAL";
  let receivedSignals: any = null;

  const chosungSkill = createMockSkill({
    id: "CHOSUNG",
    displayName: "초성게임",
    childFacingDescription: "초성 설명",
    activeSessionId: "active_chosung_session",
    onEnd: (input) => {
      chosungEnded = true;
      assert.equal(input.reason, "SWITCH_TO_WORD_CHAIN");
    },
  });

  const wordChainSkill = createMockSkill({
    id: "WORD_CHAIN",
    displayName: "끝말잇기",
    childFacingDescription: "끝말잇기 설명",
    onStart: (input) => {
      wordChainStarted = true;
      receivedUtterance = input.utterance;
      receivedSignals = input.signals;
    },
    startResult: { handled: true, instruction: "[끝말잇기] 사과! 과로 시작해줘" },
  });

  const result = await executeSkillSelection({
    db,
    childId: "child_123",
    chatSessionId: "chat_456",
    gradeRaw: 3,
    skillId: "WORD_CHAIN",
    registry: [chosungSkill, wordChainSkill],
  });

  assert.equal(result.ok, true);
  assert.equal(chosungEnded, true, "이전 활성 스킬은 end() 되어야 함");
  assert.equal(wordChainStarted, true, "선택된 스킬 start() 호출되어야 함");
  assert.equal(receivedUtterance, "", "가짜 발화 문자열을 주입하지 않고 빈 문자열이어야 함");
  assert.equal(receivedSignals.hasWordChainGameStart, false, "빈 signals가 전달되어야 함");
  assert.equal(result.skillId, "WORD_CHAIN");
  assert.equal(result.sessionId, "session_WORD_CHAIN");
  assert.equal(result.text, "[끝말잇기] 사과! 과로 시작해줘");
});

test("executeSkillSelection: Hard Guard - start 호출 후 getActiveSession 생성 검증 실패 시 에러 반환", async () => {
  const db = createMockDb();

  const brokenSkill: PlaySkillModule = {
    id: "CHOSUNG",
    displayName: "초성게임",
    childFacingDescription: "초성 설명",
    proposal: { label: "초성게임", shortDescription: "초성 설명" },
    matchesDirectRequest: () => false,
    getActiveSession: async () => null, // 세션 생성 실패 시뮬레이션
    start: async () => ({ handled: true, instruction: "게임 시작된 척 지침" }),
    handleTurn: async () => ({ handled: true }),
    end: async () => {},
  };

  const result = await executeSkillSelection({
    db,
    childId: "child_123",
    chatSessionId: "chat_456",
    skillId: "CHOSUNG",
    registry: [brokenSkill],
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "Failed to create active play session");
});
