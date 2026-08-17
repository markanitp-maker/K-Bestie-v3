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
  // 2026-08-18 프로덕션 사고: 이 테스트가 **유출을 정답으로 고정**하고 있었다.
  // "[끝말잇기] 사과! 과로 시작해줘" 는 Gemini 용 내부 지시문이다. 응답에 담으면
  // 모달이 그대로 말풍선에 띄워 아이가 시스템 프롬프트를 읽는다.
  assert.equal((result as Record<string, unknown>).text, undefined,
    "내부 지시문(instruction)이 응답에 실려 나가면 안 된다");
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

test("executeSkillSelection: 1) 선택 성공 시 openingLine이 정상 반환된다", async () => {
  const db = createMockDb();
  const mockSkill = createMockSkill({
    id: "WORD_CHAIN",
    displayName: "끝말잇기",
    childFacingDescription: "끝말잇기",
    startResult: {
      handled: true,
      instruction: "[끝말잇기] 사과! 과로 시작해줘",
      openingLine: "좋아, 끝말잇기 하자! 내가 먼저 할게. 사과!",
    },
  });

  const result = await executeSkillSelection({
    db,
    childId: "child_123",
    chatSessionId: "chat_456",
    skillId: "WORD_CHAIN",
    registry: [mockSkill],
  });

  assert.equal(result.ok, true);
  assert.equal(result.openingLine, "좋아, 끝말잇기 하자! 내가 먼저 할게. 사과!");
});

test("executeSkillSelection: 2) instruction 및 text는 어떤 경우에도 반환값에 없다", async () => {
  const db = createMockDb();
  const mockSkill = createMockSkill({
    id: "CHOSUNG",
    displayName: "초성게임",
    childFacingDescription: "초성게임",
    startResult: {
      handled: true,
      instruction: "[초성게임] 내부 지시문 비밀 내용",
      openingLine: "좋아, 초성게임 하자! ㅂㄴㄴ, 뭘까?",
    },
  });

  const result = await executeSkillSelection({
    db,
    childId: "child_123",
    chatSessionId: "chat_456",
    skillId: "CHOSUNG",
    registry: [mockSkill],
  });

  assert.equal(result.ok, true);
  assert.equal((result as Record<string, unknown>).instruction, undefined, "instruction은 결과에 없어야 함");
  assert.equal((result as Record<string, unknown>).text, undefined, "text는 결과에 없어야 함");
  assert.equal(result.openingLine, "좋아, 초성게임 하자! ㅂㄴㄴ, 뭘까?");
});

test("executeSkillSelection: 3) openingLine이 지시문 형태([ 시작 / \\n-  포함 / instruction과 동일)면 걸러진다", async () => {
  const db = createMockDb();

  // 케이스 A: [ 로 시작하는 경우
  const skillWithBracket = createMockSkill({
    id: "WORD_CHAIN",
    displayName: "끝말잇기",
    childFacingDescription: "끝말잇기",
    startResult: {
      handled: true,
      instruction: "[끝말잇기] 내부 지시문",
      openingLine: "[지시문 형태] 아이에게 유출되면 안 됨",
    },
  });

  const resA = await executeSkillSelection({
    db,
    childId: "child_123",
    chatSessionId: "chat_456",
    skillId: "WORD_CHAIN",
    registry: [skillWithBracket],
  });
  assert.equal(resA.ok, true);
  assert.equal(resA.openingLine, undefined, "[ 로 시작하는 지시문 형태는 차단되어야 함");

  // 케이스 B: \n-  가 포함된 경우
  const skillWithBullet = createMockSkill({
    id: "WORD_CHAIN",
    displayName: "끝말잇기",
    childFacingDescription: "끝말잇기",
    startResult: {
      handled: true,
      instruction: "지시문\n- 항목1",
      openingLine: "안녕하세요\n- 너는 정답을 모르는 척 해라",
    },
  });

  const resB = await executeSkillSelection({
    db,
    childId: "child_123",
    chatSessionId: "chat_456",
    skillId: "WORD_CHAIN",
    registry: [skillWithBullet],
  });
  assert.equal(resB.ok, true);
  assert.equal(resB.openingLine, undefined, "\\n- 가 포함된 지시문 형태는 차단되어야 함");

  // 케이스 C: instruction과 동일한 경우
  const skillExactSame = createMockSkill({
    id: "WORD_CHAIN",
    displayName: "끝말잇기",
    childFacingDescription: "끝말잇기",
    startResult: {
      handled: true,
      instruction: "시스템 지시문 동일 내용",
      openingLine: "시스템 지시문 동일 내용",
    },
  });

  const resC = await executeSkillSelection({
    db,
    childId: "child_123",
    chatSessionId: "chat_456",
    skillId: "WORD_CHAIN",
    registry: [skillExactSame],
  });
  assert.equal(resC.ok, true);
  assert.equal(resC.openingLine, undefined, "instruction과 동일한 값은 차단되어야 함");
});

function createFluentMockDb(overrides?: {
  chosungSession?: any;
  wordChainSession?: any;
  nonsenseQuestion?: any;
}) {
  const queryBuilder = (data: any) => {
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      order: () => builder,
      limit: () => builder,
      gte: () => builder,
      lte: () => builder,
      insert: () => builder,
      update: () => builder,
      single: async () => ({ data, error: null }),
      maybeSingle: async () => ({ data, error: null }),
      then: (resolve: any) => resolve({ data: Array.isArray(data) ? data : (data ? [data] : []), error: null }),
    };
    return builder;
  };

  return {
    from: (table: string) => {
      if (table === "chosung_game_sessions") {
        return queryBuilder(overrides?.chosungSession ?? null);
      }
      if (table === "word_chain_game_sessions") {
        return queryBuilder(overrides?.wordChainSession ?? null);
      }
      if (table === "nonsense_questions") {
        return queryBuilder(overrides?.nonsenseQuestion ?? null);
      }
      return queryBuilder(null);
    },
  } as unknown as SupabaseClient;
}

test("스킬 3종: 4) openingLine 정답 누출 방어 검증 (초성·넌센스·끝말잇기)", async () => {
  // 끝말잇기 start() 검증
  const { WORD_CHAIN_SKILL } = await import("../wordChain/wordChainSkill");
  const wcDb = createFluentMockDb();
  const wcRes = await WORD_CHAIN_SKILL.start({
    db: wcDb,
    childId: "child_123",
    chatSessionId: "chat_456",
    gradeRaw: 3,
    utterance: "",
    signals: createEmptyUtteranceSignals(),
  });
  assert.equal(wcRes.handled, true);
  assert.ok(wcRes.openingLine?.includes("끝말잇기"));
  assert.ok(wcRes.openingLine?.endsWith("!"));

  // 초성게임 start() 검증 (DB 모의)
  const chosungSession = {
    id: "session_chosung_test",
    child_id: "child_123",
    chat_session_id: "chat_456",
    state: "PLAYING_K_ASKS",
    initiated_by: "K",
    current_word: "바나나",
    current_chosung: "ㅂㄴㄴ",
    current_category: "과일",
    current_difficulty: 2,
    hint_level: 0,
    recent_words: [],
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ended_at: null,
  };

  const chosungDb = createFluentMockDb({ chosungSession });
  const { CHOSUNG_SKILL } = await import("./chosungSkill");
  const chosungRes = await CHOSUNG_SKILL.start({
    db: chosungDb,
    childId: "child_123",
    chatSessionId: "chat_456",
    gradeRaw: 3,
    utterance: "",
    signals: createEmptyUtteranceSignals(),
  });
  assert.equal(chosungRes.handled, true);
  assert.ok(chosungRes.openingLine?.includes("ㅂㄴㄴ"));
  assert.equal(chosungRes.openingLine?.includes("바나나"), false, "초성게임 정답 단어(바나나)가 openingLine에 노출되면 안 됨");

  // 넌센스 퀴즈 start() 검증
  const nonsenseQ = {
    id: "q_test_1",
    question: "세상에서 가장 뜨거운 바다는?",
    canonical_answer: "열바다",
    explanation: "열받으니까!",
    difficulty: 2,
    grade_min: 1,
    grade_max: 6,
  };

  const nonsenseDb = createFluentMockDb({ nonsenseQuestion: nonsenseQ });
  const { NONSENSE_QUIZ_SKILL } = await import("../nonsenseQuiz/nonsenseQuizSkill");
  const nonsenseRes = await NONSENSE_QUIZ_SKILL.start({
    db: nonsenseDb,
    childId: "child_123",
    chatSessionId: "chat_456",
    gradeRaw: 3,
    utterance: "",
    signals: createEmptyUtteranceSignals(),
  });
  assert.equal(nonsenseRes.handled, true);
  if (nonsenseRes.openingLine) {
    assert.ok(nonsenseRes.openingLine.includes("세상에서 가장 뜨거운 바다는?"));
    assert.equal(nonsenseRes.openingLine.includes("열바다"), false, "넌센스 정답(열바다)이 openingLine에 노출되면 안 됨");
  }
});
