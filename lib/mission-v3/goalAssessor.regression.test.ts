import assert from "node:assert/strict";
import { test } from "node:test";

import type { GenerateContentFn } from "@/lib/k-conversation/responseGenerator";

import { assessGoalsFromUtterance } from "./goalAssessor.js";
import type { MissionPromptGoal } from "./missionAdapter.js";

const makeGoal = (overrides: Partial<MissionPromptGoal> = {}): MissionPromptGoal => ({
  goalId: "goal-1",
  missionSessionId: "session-1",
  childId: "child-1",
  goalOrder: 1,
  semanticGroup: "SCHOOL_DAY",
  priority: "P1",
  status: "PENDING",
  evidenceSource: null,
  sourceTurnId: null,
  confidence: null,
  satisfiedAt: null,
  parentQuestionId: null,
  promptInstruction: "오늘 학교나 일상에서 있었던 일을 자연스럽게 확인한다.",
  ...overrides,
});

const makeAi = (generateContent: GenerateContentFn) => ({
  models: { generateContent },
});

const responseFor = (text: string) => ({ text }) as Awaited<ReturnType<GenerateContentFn>>;

const capturePrompt = async (extra: Partial<Parameters<typeof assessGoalsFromUtterance>[0]> = {}) => {
  let captured = "";
  const ai = makeAi((async (params: { contents: string }) => {
    captured = params.contents;
    return responseFor("[]");
  }) as unknown as GenerateContentFn);
  await assessGoalsFromUtterance({
    ai,
    modelId: "test-model",
    currentUtterance: "던지는 거",
    goals: [makeGoal()],
    ...extra,
  } as Parameters<typeof assessGoalsFromUtterance>[0]);
  return captured;
};

export interface ProductionRegressionCase {
  id: number;
  utterance: string;
  contextQuestion: string;
  expectedStatus: "SATISFIED" | "SKIPPED" | "PARTIAL";
  shouldNotBeSatisfied?: boolean;
  description: string;
  promptGuardPhrases: string[];
}

/**
 * Production 감사에서 도출된 실제 오판 회귀 방지 세트 (10건)
 * 완화된 기준(1~9번)과 과도한 완화를 막는 안전장치(10번)를 함께 고정한다.
 */
export const PRODUCTION_REGRESSION_CASES: readonly ProductionRegressionCase[] = [
  {
    id: 1,
    utterance: "던지는 거",
    contextQuestion: "야구 학원에서 뭐가 제일 재밌어?",
    expectedStatus: "SATISFIED",
    description: "짧은 구 답변 SATISFIED 인정 (Production 오판 사례)",
    promptGuardPhrases: ["던지는 거", "한 단어나 짧은 구라도", "SATISFIED: 아이가 그 질문이 요구한 핵심 정보를 직접 제공한 경우"],
  },
  {
    id: 2,
    utterance: "일기랑 독서록",
    contextQuestion: "무슨 숙제야?",
    expectedStatus: "SATISFIED",
    description: "단답 나열형 답변 SATISFIED 인정",
    promptGuardPhrases: ["답변 길이나 문장 완성도를 SATISFIED의 조건으로 쓰지 마라", "핵심 정보를 직접 제공한 경우"],
  },
  {
    id: 3,
    utterance: "학교 안가고 방학이야",
    contextQuestion: "학교에서 기억나는 일 있어?",
    expectedStatus: "SATISFIED",
    description: "잘못된 전제 정정 해결 처리 (방학이야)",
    promptGuardPhrases: ["아이가 질문의 잘못된 전제를 현실 정보로 정정하면", "지금 방학이야", "해결된 답변으로 취급"],
  },
  {
    id: 4,
    utterance: "가족들이랑 사촌동생",
    contextQuestion: "누구랑 갔어?",
    expectedStatus: "SATISFIED",
    description: "동행인 핵심 정보 직접 제공",
    promptGuardPhrases: ["더 자세히 이야기할 여지가 있다는 이유만으로 PARTIAL을 주지 마라", "핵심 정보를 직접 제공한 경우"],
  },
  {
    id: 5,
    utterance: "친구랑 놀았어",
    contextQuestion: "오늘 뭐 했어?",
    expectedStatus: "SATISFIED",
    description: "활동 정보 직접 제공",
    promptGuardPhrases: ["한 단어나 짧은 구라도", "핵심 정보를 직접 제공한 경우"],
  },
  {
    id: 6,
    utterance: "게임 유튜브 찍었어",
    contextQuestion: "뭐 하고 놀았어?",
    expectedStatus: "SATISFIED",
    description: "구체적 활동 단답 직접 제공",
    promptGuardPhrases: ["답변 길이나 문장 완성도를 SATISFIED의 조건으로 쓰지 마라", "SATISFIED: 아이가 그 질문이 요구한 핵심 정보를 직접 제공한 경우"],
  },
  {
    id: 7,
    utterance: "방학이라고?",
    contextQuestion: "선생님이 뭐라고 하셨어?",
    expectedStatus: "SATISFIED",
    description: "문맥상 선생님 말 회상이면 SATISFIED",
    promptGuardPhrases: ["직전에 K가 물어본 Goal을 먼저 평가", "핵심 정보를 직접 제공한 경우"],
  },
  {
    id: 8,
    utterance: "만화책",
    contextQuestion: "어떤 책 좋아해?",
    expectedStatus: "SATISFIED",
    description: "한 단어 명사 답변 SATISFIED 인정 (Production 오판 사례)",
    promptGuardPhrases: ["만화책", "어떤 책 좋아해?", "한 단어나 짧은 구라도 질문의 핵심을 직접 답했다면 SATISFIED로 판정해라"],
  },
  {
    id: 9,
    utterance: "응 많이 속상했어",
    contextQuestion: "기분 어땠어? 많이 속상했지?",
    expectedStatus: "SATISFIED",
    description: "감정 질문에 대한 감정 표현 SATISFIED 인정",
    promptGuardPhrases: ["속상했어", "기분 어땠어?", "SATISFIED: 아이가 그 질문이 요구한 핵심 정보를 직접 제공한 경우"],
  },
  {
    id: 10,
    utterance: "부루마불",
    contextQuestion: "학교에서 있었던 일을 말해줘",
    expectedStatus: "SKIPPED",
    shouldNotBeSatisfied: true,
    description: "질문과 무관한 답변 SATISFIED 금지 (과도한 완화 방지 안전장치)",
    promptGuardPhrases: ["SATISFIED 금지", "질문과 무관한 답변", "부루마불", "SKIPPED: 현재 발화와 전혀 무관해 판단 근거가 없는 경우"],
  },
];

test("079-regression: Production 회귀 세트 10건이 모두 정의되어 있다", () => {
  assert.equal(PRODUCTION_REGRESSION_CASES.length, 10);
});

// 1~9번: Production 오판 사례가 SATISFIED로 올바르게 계약 및 파싱되며 프롬프트 근거가 유지되는지 검증
for (const regCase of PRODUCTION_REGRESSION_CASES.filter((c) => !c.shouldNotBeSatisfied)) {
  test(`Production 회귀 [${regCase.id}번] "${regCase.utterance}" → ${regCase.expectedStatus} (${regCase.description})`, async () => {
    // 1. mock LLM 계약 및 파싱 검증
    const ai = makeAi((async () => responseFor(JSON.stringify([
      { goalId: "goal-1", status: regCase.expectedStatus, confidence: 0.95, evidenceSource: "child_utterance" },
    ]))) as GenerateContentFn);

    const result = await assessGoalsFromUtterance({
      ai,
      modelId: "test-model",
      currentUtterance: regCase.utterance,
      recentHistory: [{ role: "k", text: regCase.contextQuestion }],
      goals: [makeGoal({ goalId: "goal-1" })],
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.goalId, "goal-1");
    assert.equal(result[0]?.status, "SATISFIED");
    assert.equal(result[0]?.evidenceSource, "child_utterance");

    // 2. 프롬프트 내 완화 근거 문구 및 맥락 검증
    const prompt = await capturePrompt({
      currentUtterance: regCase.utterance,
      recentHistory: [{ role: "k", text: regCase.contextQuestion }],
    });

    assert.ok(prompt.includes(`K: ${regCase.contextQuestion}`), `맥락 질문 누락: ${regCase.contextQuestion}`);
    assert.ok(prompt.includes(`[아이의 현재 발화]\n${regCase.utterance}`), `현재 발화 누락: ${regCase.utterance}`);

    for (const phrase of regCase.promptGuardPhrases) {
      assert.ok(prompt.includes(phrase), `프롬프트 필수 근거 누락: ${phrase}`);
    }
  });
}

// 10번: 과도한 완화 방지 — 부루마불(질문과 무관)은 SATISFIED 금지 검증 (필수)
test("Production 회귀 [10번] 부루마불(질문과 무관) → SATISFIED 금지 및 무관 답변 안전장치 유지 검증", async () => {
  const case10 = PRODUCTION_REGRESSION_CASES.find((c) => c.id === 10)!;
  assert.ok(case10, "10번 회귀 케이스 존재 확인");
  assert.equal(case10.shouldNotBeSatisfied, true);

  // 1. 프롬프트 안전장치 검증: 무관 답변 금지 문구와 '부루마불' 예시가 반드시 포함되어야 한다.
  const prompt = await capturePrompt({
    currentUtterance: case10.utterance,
    recentHistory: [{ role: "k", text: case10.contextQuestion }],
  });

  assert.ok(
    prompt.includes("SATISFIED 금지: 질문과 무관한 답변. 예) 학교에서 있었던 일을 물었는데 \"부루마불\"만 말한 경우."),
    "프롬프트에 'SATISFIED 금지: 질문과 무관한 답변 (부루마불 예시)' 문구가 존재해야 합니다.",
  );
  assert.ok(
    prompt.includes("SKIPPED: 현재 발화와 전혀 무관해 판단 근거가 없는 경우. 근거가 없으면 배열에서 생략해도 된다."),
    "프롬프트에 SKIPPED 정의가 존재해야 합니다.",
  );

  // 2. 계약 검증: mock LLM이 SKIPPED 또는 PARTIAL을 반환했을 때 정상 파싱되며 SATISFIED로 잘못 강제되지 않음
  const skippedAi = makeAi((async () => responseFor(JSON.stringify([
    { goalId: "goal-1", status: "SKIPPED", confidence: 0.9, evidenceSource: "child_utterance" },
  ]))) as GenerateContentFn);

  const skippedResult = await assessGoalsFromUtterance({
    ai: skippedAi,
    modelId: "test-model",
    currentUtterance: case10.utterance,
    recentHistory: [{ role: "k", text: case10.contextQuestion }],
    goals: [makeGoal({ goalId: "goal-1" })],
  });

  assert.equal(skippedResult.length, 1);
  assert.equal(skippedResult[0]?.status, "SKIPPED");
  assert.notEqual(skippedResult[0]?.status, "SATISFIED", "무관 답변이 SATISFIED가 되어서는 안 됨");

  // PARTIAL 반환 시에도 PARTIAL로 파싱됨을 확인
  const partialAi = makeAi((async () => responseFor(JSON.stringify([
    { goalId: "goal-1", status: "PARTIAL", confidence: 0.5, evidenceSource: "child_utterance" },
  ]))) as GenerateContentFn);

  const partialResult = await assessGoalsFromUtterance({
    ai: partialAi,
    modelId: "test-model",
    currentUtterance: case10.utterance,
    recentHistory: [{ role: "k", text: case10.contextQuestion }],
    goals: [makeGoal({ goalId: "goal-1" })],
  });

  assert.equal(partialResult.length, 1);
  assert.equal(partialResult[0]?.status, "PARTIAL");
  assert.notEqual(partialResult[0]?.status, "SATISFIED");
});
