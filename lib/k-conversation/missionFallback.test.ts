// 요청서 019 — 미션 LLM Fallback 긴급 핫픽스.
//
// 검증 대상 두 가지다.
//   1. responseGenerator: 실시간 retry budget, 실패 유형 분류, fallbackUsed 신호
//   2. missionAdapter: 생성 실패 시 자유대화 폴백 대신 결정론 미션 질문

import assert from "node:assert/strict";
import test from "node:test";

import { TOTAL_RETRY_BUDGET_MS as ASSESSOR_BUDGET_MS } from "@/lib/mission-v3/goalAssessor";
import {
  ATTEMPT_TIMEOUT_MS,
  RETRY_DELAYS_MS,
  TOTAL_RETRY_BUDGET_MS,
  classifyGenerationFailure,
  generateResponse,
  type GenerateContentFn,
  type ResponseGeneratorInput,
} from "./responseGenerator";
import {
  buildMissionDeterministicFallback,
  containsMissionForbiddenFallback,
  respondToMissionTurn,
  MISSION_FALLBACK_ACKNOWLEDGEMENT_ONLY,
  type MissionPromptGoal,
} from "@/lib/mission-v3/missionAdapter";

const baseInput: ResponseGeneratorInput = {
  mode: "MISSION",
  action: "EMPATHY",
  corePersonaFragment: "[K Core Persona]",
  gradePersonaFragment: "[Grade Persona]",
  memoryFragment: "[Memory]",
  currentUtterance: "엄마 아빠가 돌봐준거",
  recentHistory: [],
  correlationId: "turn-1",
};

const makeGoal = (overrides: Partial<MissionPromptGoal> = {}): MissionPromptGoal => ({
  goalId: "goal-1",
  missionSessionId: "ms-1",
  childId: "child-1",
  goalOrder: 1,
  semanticGroup: "DAILY_HIGHLIGHT",
  priority: "P1",
  status: "PENDING",
  evidenceSource: null,
  sourceTurnId: null,
  confidence: null,
  satisfiedAt: null,
  parentQuestionId: null,
  promptInstruction: "오늘 하루를 자연스럽게 확인한다.",
  fallbackQuestionText: "다음 달의 너에게 기대하는 모습은 뭐야?",
  ...overrides,
});

const apiError = (code: number) => Object.assign(new Error(`{"error":{"code":${code}}}`), { status: code });

test("019: 429 는 RATE_LIMIT 으로 분류한다", () => {
  assert.equal(classifyGenerationFailure(apiError(429)), "RATE_LIMIT");
  assert.equal(
    classifyGenerationFailure(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}')),
    "RATE_LIMIT",
  );
});

test("019: 5xx / 타임아웃 / 네트워크를 각각 구분한다", () => {
  assert.equal(classifyGenerationFailure(apiError(503)), "HTTP_5XX");
  assert.equal(classifyGenerationFailure(new Error("response-generator-timeout")), "TIMEOUT");
  assert.equal(classifyGenerationFailure(new Error("fetch failed")), "NETWORK_ERROR");
  assert.equal(classifyGenerationFailure(new Error("뭔가 다른 오류")), "UNKNOWN");
});

test("019: retry 지연 총합이 실시간 대화 예산 안에 있다", () => {
  const totalDelay = RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);
  // 기존 [0,3000,5000] = 8초. 아이가 정상 답변한 뒤 12.8~26.8초를 기다린 원인이었다.
  assert.ok(totalDelay <= 2000, `retry 지연 총합이 너무 크다: ${totalDelay}ms`);
  assert.ok(ATTEMPT_TIMEOUT_MS <= TOTAL_RETRY_BUDGET_MS, "한 시도의 timeout 이 총 예산을 넘는다");
});

test("019: 모든 시도가 실패하면 fallbackUsed 와 실패 유형을 함께 돌려준다", async () => {
  const ai = {
    models: {
      generateContent: (async () => {
        throw apiError(503);
      }) as unknown as GenerateContentFn,
    },
  };

  const startedAt = Date.now();
  const result = await generateResponse({ ai, modelId: "test-model", input: baseInput });
  const elapsed = Date.now() - startedAt;

  assert.equal(result.fallbackUsed, true);
  assert.equal(result.failureType, "HTTP_5XX");
  // 기존 정책이면 지연만 8초였다.
  assert.ok(elapsed < 4000, `실패 경로가 너무 오래 걸린다: ${elapsed}ms`);
});

test("019: 성공하면 fallbackUsed 는 false 다", async () => {
  const ai = {
    models: {
      generateContent: (async () => ({
        text: "오, 그랬구나! 오늘 제일 재밌었던 건 뭐야?",
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      })) as unknown as GenerateContentFn,
    },
  };
  const result = await generateResponse({ ai, modelId: "test-model", input: baseInput });
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.text, "오, 그랬구나! 오늘 제일 재밌었던 건 뭐야?");
});

test("019: 자유대화 폴백 문구는 미션 금지 문구 검사에 걸린다", async () => {
  const ai = {
    models: {
      generateContent: (async () => {
        throw apiError(429);
      }) as unknown as GenerateContentFn,
    },
  };
  const result = await generateResponse({ ai, modelId: "test-model", input: baseInput });
  assert.ok(
    containsMissionForbiddenFallback(result.text),
    "자유대화 폴백이 미션 금지 문구로 인식되지 않으면 Adapter 교체가 무의미하다",
  );
});

test("019: 금지 문구 검사가 대표 제보 문장들을 모두 잡는다", () => {
  for (const text of [
    "응, 듣고 있어. 더 얘기해줄래?",
    "응 듣고있어 계속 말해줘",
    "계속 말해줘",
    "더 얘기해줄래?",
    "계속 얘기해줘",
    "더 말해줘",
  ]) {
    assert.ok(containsMissionForbiddenFallback(text), `금지 문구 미검출: ${text}`);
  }
});

test("019: 정상 미션 응답은 금지 문구로 잡히지 않는다", () => {
  for (const text of [
    "오, 그랬구나! 오늘 제일 재밌었던 건 뭐야?",
    "친구랑 축구했구나. 누구랑 같이 했어?",
    "그렇구나, 얘기해줘서 고마워. 다음 달의 너에게 기대하는 모습은 뭐야?",
  ]) {
    assert.equal(containsMissionForbiddenFallback(text), false, `정상 응답 오탐: ${text}`);
  }
});

test("019: 결정론 폴백은 이번 턴 promptGoal 의 완성 질문을 쓴다", () => {
  const promptGoal = makeGoal({ fallbackQuestionText: "오늘 제일 신났던 순간은 언제야?" });
  const text = buildMissionDeterministicFallback({
    promptGoal,
    goals: [promptGoal],
    seed: "turn-1",
  });
  assert.ok(text);
  assert.ok(text!.includes("오늘 제일 신났던 순간은 언제야?"), "다음 질문이 빠졌다");
  assert.equal(containsMissionForbiddenFallback(text!), false, "폴백이 같은 답을 다시 요구한다");
});

test("019: promptGoal 이 없으면 열린 Goal 의 질문으로 진행한다", () => {
  const openGoal = makeGoal({ goalId: "goal-2", fallbackQuestionText: "요즘 제일 자주 하는 놀이가 뭐야?" });
  const text = buildMissionDeterministicFallback({ promptGoal: null, goals: [openGoal], seed: "t" });
  assert.ok(text?.includes("요즘 제일 자주 하는 놀이가 뭐야?"));
});

test("019: 종료된 Goal 의 질문은 쓰지 않는다", () => {
  const closed = makeGoal({ status: "SATISFIED", fallbackQuestionText: "이미 끝난 질문이야?" });
  const text = buildMissionDeterministicFallback({ promptGoal: null, goals: [closed], seed: "t" });
  assert.equal(text, null, "이미 SATISFIED 된 Goal 질문을 다시 던졌다");
});

test("019: 쓸 질문이 하나도 없으면 null 을 돌려준다", () => {
  const text = buildMissionDeterministicFallback({ promptGoal: null, goals: [], seed: "t" });
  assert.equal(text, null);
});

test("019: 같은 턴은 항상 같은 폴백 문장을 만든다(재시도 시 화면이 흔들리지 않는다)", () => {
  const goal = makeGoal();
  const first = buildMissionDeterministicFallback({ promptGoal: goal, goals: [goal], seed: "turn-42" });
  const second = buildMissionDeterministicFallback({ promptGoal: goal, goals: [goal], seed: "turn-42" });
  assert.equal(first, second);
});

// ── Adapter 통합: 생성 실패가 실제로 결정론 문장으로 교체되는지 ─────────────

test("019: 미션 Adapter 는 생성 폴백 응답을 결정론 질문으로 교체한다", async () => {
  const goal = makeGoal({ fallbackQuestionText: "다음 달의 너에게 기대하는 모습은 뭐야?" });
  const result = await respondToMissionTurn({
    db: {} as never,
    ai: null as never,
    modelId: "test-model",
    childId: "child-1",
    sessionId: "session-1",
    currentUtterance: "엄마 아빠가 돌봐준거",
    sourceTurnId: "turn-1",
    currentTurnId: "client-turn-1",
    goals: [goal],
    assessments: [],
    engine: {
      checkSafetyPreflight: async () => null,
      respond: async () => ({
        text: "응, 듣고 있어. 더 얘기해줄래?",
        action: "JUST_LISTEN" as const,
        category: "generated" as const,
        tokenIn: 0,
        tokenOut: 0,
        generationFallback: true,
        generationFailureType: "RATE_LIMIT",
      }),
      isTopicOnCooldownForK: async () => false,
      recordTopicUsage: async () => undefined,
    },
  });

  assert.equal(
    containsMissionForbiddenFallback(result.engineOutput.text),
    false,
    "미션에서 자유대화 폴백이 그대로 나갔다",
  );
  assert.ok(
    result.engineOutput.text.includes("다음 달의 너에게 기대하는 모습은 뭐야?"),
    "다음 미션 질문으로 진행하지 않았다",
  );
});

test("019: 생성이 성공한 응답은 Adapter 가 건드리지 않는다", async () => {
  const goal = makeGoal();
  const generated = "축구했구나! 누구랑 같이 했어?";
  const result = await respondToMissionTurn({
    db: {} as never,
    ai: null as never,
    modelId: "test-model",
    childId: "child-1",
    sessionId: "session-1",
    currentUtterance: "민준이랑 축구했어",
    sourceTurnId: "turn-2",
    goals: [goal],
    assessments: [],
    engine: {
      checkSafetyPreflight: async () => null,
      respond: async () => ({
        text: generated,
        action: "CURIOSITY" as const,
        category: "generated" as const,
        tokenIn: 1,
        tokenOut: 1,
        generationFallback: false,
      }),
      isTopicOnCooldownForK: async () => false,
      recordTopicUsage: async () => undefined,
    },
  });
  assert.equal(result.engineOutput.text, generated);
});

test("019: Safety 응답은 폴백 교체보다 우선한다", async () => {
  const goal = makeGoal();
  const safetyText = "그런 생각이 들었구나. 지금 옆에 있는 어른한테 꼭 말해줘.";
  const result = await respondToMissionTurn({
    db: {} as never,
    ai: null as never,
    modelId: "test-model",
    childId: "child-1",
    sessionId: "session-1",
    currentUtterance: "위험 발화",
    sourceTurnId: "turn-3",
    goals: [goal],
    assessments: [],
    engine: {
      checkSafetyPreflight: async () => ({
        text: safetyText,
        action: "COMFORT" as const,
        category: "safety" as const,
        safetyFlagged: true,
        tokenIn: 0,
        tokenOut: 0,
      }),
      respond: async () => {
        throw new Error("Safety 뒤에 respond 가 호출되면 안 된다.");
      },
      isTopicOnCooldownForK: async () => false,
      recordTopicUsage: async () => undefined,
    },
  });
  assert.equal(result.engineOutput.text, safetyText);
});

// ── 리뷰 반려 사항(2026-08-19) 대응 ────────────────────────────────

test("019: Goal 판정과 응답 생성 예산의 합이 10초 미만이다", () => {
  // 두 모듈은 /api/mission/v3/turn 한 요청 안에서 순차로 돈다. 각자 예산만 보면
  // 합이 그대로 아이의 대기시간이 된다(리뷰 BLOCKER: 7s + 9s = 16s).
  const worstCase = ASSESSOR_BUDGET_MS + TOTAL_RETRY_BUDGET_MS;
  assert.ok(worstCase < 10_000, `최악 대기시간이 너무 길다: ${worstCase}ms`);
});

test("019: 429 는 재시도하지 않고 즉시 폴백한다", async () => {
  // 용량 한도는 수백 ms 뒤에 풀리지 않는다. 재시도는 아이를 기다리게만 하고
  // 한도를 더 밀어붙인다(2026-08-19 Production: 3회 시도가 전부 429).
  let calls = 0;
  const ai = {
    models: {
      generateContent: (async () => {
        calls += 1;
        throw apiError(429);
      }) as unknown as GenerateContentFn,
    },
  };
  const startedAt = Date.now();
  const result = await generateResponse({ ai, modelId: "test-model", input: baseInput });
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.failureType, "RATE_LIMIT");
  assert.equal(calls, 1, "429 인데도 재시도했다");
  assert.ok(Date.now() - startedAt < 500, `429 폴백이 느리다: ${Date.now() - startedAt}ms`);
});

test("019: 429 가 아닌 실패(5xx)는 예산 안에서 재시도한다", async () => {
  let calls = 0;
  const ai = {
    models: {
      generateContent: (async () => {
        calls += 1;
        throw apiError(503);
      }) as unknown as GenerateContentFn,
    },
  };
  const result = await generateResponse({ ai, modelId: "test-model", input: baseInput });
  assert.equal(result.failureType, "HTTP_5XX");
  assert.ok(calls >= 2, "일시적 5xx 에서는 재시도해야 한다");
});

test("019: 던질 질문이 없으면 인정 문구만 내보내고 자유대화 폴백을 쓰지 않는다", async () => {
  const closed = makeGoal({ status: "SATISFIED" });
  const result = await respondToMissionTurn({
    db: {} as never,
    ai: null as never,
    modelId: "test-model",
    childId: "child-1",
    sessionId: "session-1",
    currentUtterance: "즐거운 기분!",
    sourceTurnId: "turn-9",
    goals: [closed],
    assessments: [],
    engine: {
      checkSafetyPreflight: async () => null,
      respond: async () => ({
        text: "응, 듣고 있어. 더 얘기해줄래?",
        action: "JUST_LISTEN" as const,
        category: "generated" as const,
        tokenIn: 0,
        tokenOut: 0,
        generationFallback: true,
        generationFailureType: "RATE_LIMIT",
      }),
      isTopicOnCooldownForK: async () => false,
      recordTopicUsage: async () => undefined,
    },
  });
  assert.equal(result.engineOutput.text, MISSION_FALLBACK_ACKNOWLEDGEMENT_ONLY);
  assert.equal(containsMissionForbiddenFallback(result.engineOutput.text), false);
});

test("019: 인정 문구 자체가 금지 문구에 걸리지 않는다", () => {
  assert.equal(containsMissionForbiddenFallback(MISSION_FALLBACK_ACKNOWLEDGEMENT_ONLY), false);
});
