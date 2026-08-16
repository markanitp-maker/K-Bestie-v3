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
  promptInstruction: "오늘 학교에서 있었던 일을 자연스럽게 확인한다.",
  ...overrides,
});

const makeAi = (generateContent: GenerateContentFn) => ({
  models: { generateContent },
});

const responseFor = (text: string) => ({ text }) as Awaited<ReturnType<GenerateContentFn>>;

test("정상 JSON 배열 응답을 GoalAssessment로 변환한다", async () => {
  const ai = makeAi((async () => responseFor(JSON.stringify([
    { goalId: "goal-1", status: "SATISFIED", confidence: 0.9, evidenceSource: "child_utterance" },
  ]))) as GenerateContentFn);

  const result = await assessGoalsFromUtterance({
    ai,
    modelId: "test-model",
    currentUtterance: "오늘 수학 시간에 발표했어.",
    goals: [makeGoal()],
  });

  assert.deepEqual(result, [{
    goalId: "goal-1",
    semanticGroup: "SCHOOL_DAY",
    status: "SATISFIED",
    confidence: 0.9,
    evidenceSource: "child_utterance",
  }]);
});

test("입력 Goal이 없으면 API를 호출하지 않고 빈 배열을 반환한다", async () => {
  let calls = 0;
  const ai = makeAi((async () => {
    calls += 1;
    return responseFor("[]");
  }) as GenerateContentFn);

  const result = await assessGoalsFromUtterance({ ai, modelId: "test-model", currentUtterance: "안녕", goals: [] });

  assert.deepEqual(result, []);
  assert.equal(calls, 0);
});

test("존재하지 않는 goalId는 그 원소만 걸러낸다", async () => {
  const ai = makeAi((async () => responseFor(JSON.stringify([
    { goalId: "unknown", status: "SATISFIED", confidence: 0.9, evidenceSource: "child_utterance" },
    { goalId: "goal-1", status: "PARTIAL", confidence: 0.6, evidenceSource: "child_utterance" },
  ]))) as GenerateContentFn);

  const result = await assessGoalsFromUtterance({ ai, modelId: "test-model", currentUtterance: "조금 말했어", goals: [makeGoal()] });

  assert.deepEqual(result.map((assessment) => assessment.goalId), ["goal-1"]);
});

test("잘못된 status는 그 원소만 걸러낸다", async () => {
  const ai = makeAi((async () => responseFor(JSON.stringify([
    { goalId: "goal-1", status: "UNKNOWN", confidence: 0.9, evidenceSource: "child_utterance" },
    { goalId: "goal-2", status: "PARTIAL", confidence: 0.6, evidenceSource: "child_utterance" },
  ]))) as GenerateContentFn);
  const goals = [makeGoal(), makeGoal({ goalId: "goal-2", semanticGroup: "PEER_RELATION" })];

  const result = await assessGoalsFromUtterance({ ai, modelId: "test-model", currentUtterance: "말했어", goals });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.goalId, "goal-2");
});

test("범위를 벗어난 confidence는 그 원소만 걸러낸다", async () => {
  const ai = makeAi((async () => responseFor(JSON.stringify([
    { goalId: "goal-1", status: "SATISFIED", confidence: 1.5, evidenceSource: "child_utterance" },
    { goalId: "goal-2", status: "PARTIAL", confidence: -0.1, evidenceSource: "child_utterance" },
    { goalId: "goal-3", status: "SATISFIED", confidence: 0.9, evidenceSource: "child_utterance" },
  ]))) as GenerateContentFn);
  const goals = [
    makeGoal(),
    makeGoal({ goalId: "goal-2", semanticGroup: "PEER_RELATION" }),
    makeGoal({ goalId: "goal-3", semanticGroup: "HOBBY" }),
  ];

  const result = await assessGoalsFromUtterance({ ai, modelId: "test-model", currentUtterance: "친구랑 놀았어", goals });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.goalId, "goal-3");
});

test("evidenceSource는 모델 응답과 무관하게 child_utterance로 고정한다", async () => {
  const ai = makeAi((async () => responseFor(JSON.stringify([
    { goalId: "goal-1", status: "SATISFIED", confidence: 0.9, evidenceSource: "memory" },
  ]))) as GenerateContentFn);

  const result = await assessGoalsFromUtterance({ ai, modelId: "test-model", currentUtterance: "말했어", goals: [makeGoal()] });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.evidenceSource, "child_utterance");
});

test("비JSON 응답은 3회 재시도 후 빈 배열로 보류 처리한다", async () => {
  let calls = 0;
  const ai = makeAi((async () => {
    calls += 1;
    return responseFor("판정 결과를 알려드릴게요");
  }) as GenerateContentFn);

  const result = await assessGoalsFromUtterance({ ai, modelId: "test-model", currentUtterance: "말했어", goals: [makeGoal()] });

  assert.deepEqual(result, []);
  assert.equal(calls, 3);
});

test("API가 세 번 모두 예외를 던지면 빈 배열을 반환한다", async () => {
  let calls = 0;
  const ai = makeAi((async () => {
    calls += 1;
    throw new Error("network failure");
  }) as GenerateContentFn);

  const result = await assessGoalsFromUtterance({ ai, modelId: "test-model", currentUtterance: "말했어", goals: [makeGoal()] });

  assert.deepEqual(result, []);
  assert.equal(calls, 3);
});

/** 079 — Production 290턴 중 18건(6.2%)이 질문에 명백히 답했는데 SATISFIED가 되지
 *  않았다. 원인은 별 UI가 아니라 판정 프롬프트였다. 아래 테스트는 완화된 기준과
 *  과도한 완화를 막는 안전장치가 함께 프롬프트에 남아 있는지 고정한다. */
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

test("079: 완화된 판정 기준 문구가 모두 프롬프트에 있다", async () => {
  const prompt = await capturePrompt();
  const required = [
    "핵심 정보를 직접 제공한 경우",
    "답변 길이나 문장 완성도를 SATISFIED의 조건으로 쓰지 마라",
    "한 단어나 짧은 구라도",
    "더 자세히 이야기할 여지가 있다는 이유만으로 PARTIAL을 주지 마라",
    "핵심 정보가 실제로 아직 빠진 경우에만",
    "해결된 답변으로 취급",
    "직전에 K가 물어본 Goal을 먼저 평가",
    "학년이 낮을수록",
  ];
  for (const phrase of required) {
    assert.ok(prompt.includes(phrase), `프롬프트에 빠진 문구: ${phrase}`);
  }
});

test("079: 과도한 완화를 막는 PARTIAL·금지 예시가 남아 있다", async () => {
  const prompt = await capturePrompt();
  assert.ok(prompt.includes("있다는 것만 알고 무엇인지 모름"), "PARTIAL 예시 누락");
  assert.ok(prompt.includes("이유가 빠짐"), "PARTIAL 예시 누락");
  assert.ok(prompt.includes("SATISFIED 금지"), "무관 답변 금지 문구 누락");
  assert.ok(prompt.includes("부루마불"), "무관 답변 예시 누락");
});

test("079: Production 오판 사례가 SATISFIED 예시로 들어가 있다", async () => {
  const prompt = await capturePrompt();
  for (const example of ["던지는 거", "만화책", "속상했어", "로블록스"]) {
    assert.ok(prompt.includes(example), `SATISFIED 예시 누락: ${example}`);
  }
});

test("079: gradeRaw를 주면 학년이 프롬프트에 들어간다", async () => {
  const prompt = await capturePrompt({ gradeRaw: "초2" });
  assert.ok(prompt.includes("[아이 학년] 초2"), "학년 문구 누락");
});

test("079: gradeRaw가 없으면 학년 문구가 없다(하위 호환)", async () => {
  const prompt = await capturePrompt();
  assert.ok(!prompt.includes("[아이 학년]"), "학년 문구가 잘못 포함됨");
});

test("079: 기존 DECLINED·SKIPPED 정의와 JSON 계약이 유지된다", async () => {
  const prompt = await capturePrompt();
  assert.ok(prompt.includes("DECLINED:"), "DECLINED 정의 누락");
  assert.ok(prompt.includes("SKIPPED:"), "SKIPPED 정의 누락");
  assert.ok(prompt.includes("evidenceSource는 모든 원소에서 반드시 child_utterance"), "JSON 계약 누락");
});
