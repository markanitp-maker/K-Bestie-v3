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
