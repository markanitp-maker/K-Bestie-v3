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
    currentUtterance: "로블록스",
    goals: [makeGoal()],
    ...extra,
  } as Parameters<typeof assessGoalsFromUtterance>[0]);
  return captured;
};

export interface GoalAssessorFixture {
  id: string;
  gradeGroup: "초1~2" | "초3~4" | "초5~6";
  gradeRaw: string;
  question: string;
  answer: string;
  expectedStatus: "SATISFIED" | "PARTIAL" | "DECLINED";
  allowedStatuses?: Array<"SATISFIED" | "PARTIAL" | "DECLINED" | "SKIPPED">;
  note?: string;
}

/** 초1~2 판정 fixture (7건) */
export const LOWER_GRADE_FIXTURES: readonly GoalAssessorFixture[] = [
  { id: "g12-1", gradeGroup: "초1~2", gradeRaw: "초1", question: "무슨 게임 해?", answer: "로블록스", expectedStatus: "SATISFIED" },
  { id: "g12-2", gradeGroup: "초1~2", gradeRaw: "초1", question: "누구랑 놀았어?", answer: "엄마랑", expectedStatus: "SATISFIED" },
  { id: "g12-3", gradeGroup: "초1~2", gradeRaw: "초2", question: "뭐 먹었어?", answer: "김밥", expectedStatus: "SATISFIED" },
  { id: "g12-4", gradeGroup: "초1~2", gradeRaw: "초2", question: "기분 어때?", answer: "좋아", expectedStatus: "SATISFIED" },
  { id: "g12-5", gradeGroup: "초1~2", gradeRaw: "초1", question: "오늘 몸 어때?", answer: "피곤해", expectedStatus: "SATISFIED" },
  { id: "g12-6", gradeGroup: "초1~2", gradeRaw: "초2", question: "새로 좋아하는 거 있어?", answer: "응", expectedStatus: "PARTIAL" },
  { id: "g12-7", gradeGroup: "초1~2", gradeRaw: "초1", question: "뭐 하고 놀았어?", answer: "몰라", expectedStatus: "PARTIAL", allowedStatuses: ["PARTIAL", "DECLINED"] },
] as const;

/** 초3~4 판정 fixture (6건) */
export const MIDDLE_GRADE_FIXTURES: readonly GoalAssessorFixture[] = [
  { id: "g34-1", gradeGroup: "초3~4", gradeRaw: "초3", question: "야구 학원에서 뭐가 제일 재밌어?", answer: "던지는 거", expectedStatus: "SATISFIED" },
  { id: "g34-2", gradeGroup: "초3~4", gradeRaw: "초3", question: "무슨 숙제야?", answer: "일기랑 독서록", expectedStatus: "SATISFIED" },
  { id: "g34-3", gradeGroup: "초3~4", gradeRaw: "초4", question: "누구랑 갔어?", answer: "가족들이랑 사촌동생", expectedStatus: "SATISFIED" },
  { id: "g34-4", gradeGroup: "초3~4", gradeRaw: "초4", question: "어떤 책 좋아해?", answer: "만화책", expectedStatus: "SATISFIED" },
  { id: "g34-5", gradeGroup: "초3~4", gradeRaw: "초3", question: "학교에서 기억나는 일?", answer: "학교 안 가고 방학이야", expectedStatus: "SATISFIED", note: "해결 처리" },
  { id: "g34-6", gradeGroup: "초3~4", gradeRaw: "초4", question: "새로 좋아하는 거 있어?", answer: "응", expectedStatus: "PARTIAL" },
] as const;

/** 초5~6 판정 fixture (5건) */
export const UPPER_GRADE_FIXTURES: readonly GoalAssessorFixture[] = [
  { id: "g56-1", gradeGroup: "초5~6", gradeRaw: "초5", question: "요즘 제일 많이 하는 게임?", answer: "발로란트", expectedStatus: "SATISFIED" },
  { id: "g56-2", gradeGroup: "초5~6", gradeRaw: "초6", question: "친구들이랑 뭐 했어?", answer: "농구", expectedStatus: "SATISFIED" },
  { id: "g56-3", gradeGroup: "초5~6", gradeRaw: "초5", question: "오늘 기분 어땠어?", answer: "좀 짜증났어", expectedStatus: "SATISFIED" },
  { id: "g56-4", gradeGroup: "초5~6", gradeRaw: "초6", question: "왜 짜증났어?", answer: "짜증났어", expectedStatus: "PARTIAL" },
  { id: "g56-5", gradeGroup: "초5~6", gradeRaw: "초5", question: "어떤 점이 재밌어?", answer: "그냥", expectedStatus: "PARTIAL" },
] as const;

export const ALL_GOAL_ASSESSOR_FIXTURES: readonly GoalAssessorFixture[] = [
  ...LOWER_GRADE_FIXTURES,
  ...MIDDLE_GRADE_FIXTURES,
  ...UPPER_GRADE_FIXTURES,
];

test("079-fixtures: 고정 fixture 총 18건(초1~2: 7건, 초3~4: 6건, 초5~6: 5건)이 정의되어 있다", () => {
  assert.equal(LOWER_GRADE_FIXTURES.length, 7);
  assert.equal(MIDDLE_GRADE_FIXTURES.length, 6);
  assert.equal(UPPER_GRADE_FIXTURES.length, 5);
  assert.equal(ALL_GOAL_ASSESSOR_FIXTURES.length, 18);
});

for (const fixture of LOWER_GRADE_FIXTURES) {
  test(`초1~2 fixture [${fixture.id}] "${fixture.question}" → "${fixture.answer}" (${fixture.expectedStatus})`, async () => {
    // 1. mock LLM 계약 및 파싱 검증
    const ai = makeAi((async () => responseFor(JSON.stringify([
      { goalId: "goal-1", status: fixture.expectedStatus, confidence: 0.95, evidenceSource: "child_utterance" },
    ]))) as GenerateContentFn);

    const result = await assessGoalsFromUtterance({
      ai,
      modelId: "test-model",
      currentUtterance: fixture.answer,
      recentHistory: [{ role: "k", text: fixture.question }],
      goals: [makeGoal({ goalId: "goal-1" })],
      gradeRaw: fixture.gradeRaw,
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.goalId, "goal-1");
    assert.equal(result[0]?.status, fixture.expectedStatus);
    assert.equal(result[0]?.evidenceSource, "child_utterance");

    // '몰라'와 같이 DECLINED도 허용되는 경우 추가 검증
    if (fixture.allowedStatuses?.includes("DECLINED")) {
      const declinedAi = makeAi((async () => responseFor(JSON.stringify([
        { goalId: "goal-1", status: "DECLINED", confidence: 0.9, evidenceSource: "child_utterance" },
      ]))) as GenerateContentFn);
      const declinedResult = await assessGoalsFromUtterance({
        ai: declinedAi,
        modelId: "test-model",
        currentUtterance: fixture.answer,
        recentHistory: [{ role: "k", text: fixture.question }],
        goals: [makeGoal({ goalId: "goal-1" })],
        gradeRaw: fixture.gradeRaw,
      });
      assert.equal(declinedResult[0]?.status, "DECLINED");
    }

    // 2. 프롬프트 근거 문구 검증
    const prompt = await capturePrompt({
      currentUtterance: fixture.answer,
      recentHistory: [{ role: "k", text: fixture.question }],
      gradeRaw: fixture.gradeRaw,
    });

    assert.ok(prompt.includes(`K: ${fixture.question}`), "프롬프트 맥락 질문 누락");
    assert.ok(prompt.includes(`[아이의 현재 발화]\n${fixture.answer}`), "프롬프트 아이 발화 누락");
    assert.ok(prompt.includes(`[아이 학년] ${fixture.gradeRaw}`), "프롬프트 학년 누락");
    assert.ok(prompt.includes("학년이 낮을수록 짧은 답변을 정상적인 의사표현으로 더 적극적으로 인정해라"), "저학년 완화 지침 누락");

    if (fixture.expectedStatus === "SATISFIED") {
      assert.ok(prompt.includes("SATISFIED: 아이가 그 질문이 요구한 핵심 정보를 직접 제공한 경우"), "SATISFIED 기준 누락");
      assert.ok(prompt.includes("한 단어나 짧은 구라도 질문의 핵심을 직접 답했다면 SATISFIED로 판정해라"), "단답 인정 지침 누락");
    } else if (fixture.expectedStatus === "PARTIAL") {
      assert.ok(prompt.includes("PARTIAL: 질문이 요구한 핵심 정보가 실제로 아직 빠진 경우에만 쓴다"), "PARTIAL 기준 누락");
    }
  });
}

for (const fixture of MIDDLE_GRADE_FIXTURES) {
  test(`초3~4 fixture [${fixture.id}] "${fixture.question}" → "${fixture.answer}" (${fixture.expectedStatus}${fixture.note ? ` - ${fixture.note}` : ""})`, async () => {
    // 1. mock LLM 계약 및 파싱 검증
    const ai = makeAi((async () => responseFor(JSON.stringify([
      { goalId: "goal-1", status: fixture.expectedStatus, confidence: 0.9, evidenceSource: "child_utterance" },
    ]))) as GenerateContentFn);

    const result = await assessGoalsFromUtterance({
      ai,
      modelId: "test-model",
      currentUtterance: fixture.answer,
      recentHistory: [{ role: "k", text: fixture.question }],
      goals: [makeGoal({ goalId: "goal-1" })],
      gradeRaw: fixture.gradeRaw,
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.goalId, "goal-1");
    assert.equal(result[0]?.status, fixture.expectedStatus);
    assert.equal(result[0]?.evidenceSource, "child_utterance");

    // 2. 프롬프트 근거 문구 검증
    const prompt = await capturePrompt({
      currentUtterance: fixture.answer,
      recentHistory: [{ role: "k", text: fixture.question }],
      gradeRaw: fixture.gradeRaw,
    });

    assert.ok(prompt.includes(`K: ${fixture.question}`), "프롬프트 맥락 질문 누락");
    assert.ok(prompt.includes(`[아이의 현재 발화]\n${fixture.answer}`), "프롬프트 아이 발화 누락");
    assert.ok(prompt.includes(`[아이 학년] ${fixture.gradeRaw}`), "프롬프트 학년 누락");

    if (fixture.note === "해결 처리") {
      assert.ok(
        prompt.includes("아이가 질문의 잘못된 전제를 현실 정보로 정정하면(예: 학교 질문에 \"지금 방학이야\"), 그 질문을 다시 묻지 않도록 해결된 답변으로 취급해라."),
        "전제 정정 해결 처리 지침 누락",
      );
    } else if (fixture.expectedStatus === "SATISFIED") {
      assert.ok(prompt.includes("SATISFIED: 아이가 그 질문이 요구한 핵심 정보를 직접 제공한 경우"), "SATISFIED 기준 누락");
      assert.ok(prompt.includes("초등학생의 답변은 짧고 단순할 수 있다"), "초등학생 단순 답변 인정 지침 누락");
    } else if (fixture.expectedStatus === "PARTIAL") {
      assert.ok(prompt.includes("PARTIAL: 질문이 요구한 핵심 정보가 실제로 아직 빠진 경우에만 쓴다"), "PARTIAL 기준 누락");
    }
  });
}

for (const fixture of UPPER_GRADE_FIXTURES) {
  test(`초5~6 fixture [${fixture.id}] "${fixture.question}" → "${fixture.answer}" (${fixture.expectedStatus})`, async () => {
    // 1. mock LLM 계약 및 파싱 검증
    const ai = makeAi((async () => responseFor(JSON.stringify([
      { goalId: "goal-1", status: fixture.expectedStatus, confidence: 0.9, evidenceSource: "child_utterance" },
    ]))) as GenerateContentFn);

    const result = await assessGoalsFromUtterance({
      ai,
      modelId: "test-model",
      currentUtterance: fixture.answer,
      recentHistory: [{ role: "k", text: fixture.question }],
      goals: [makeGoal({ goalId: "goal-1" })],
      gradeRaw: fixture.gradeRaw,
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.goalId, "goal-1");
    assert.equal(result[0]?.status, fixture.expectedStatus);
    assert.equal(result[0]?.evidenceSource, "child_utterance");

    // 2. 프롬프트 근거 문구 검증
    const prompt = await capturePrompt({
      currentUtterance: fixture.answer,
      recentHistory: [{ role: "k", text: fixture.question }],
      gradeRaw: fixture.gradeRaw,
    });

    assert.ok(prompt.includes(`K: ${fixture.question}`), "프롬프트 맥락 질문 누락");
    assert.ok(prompt.includes(`[아이의 현재 발화]\n${fixture.answer}`), "프롬프트 아이 발화 누락");
    assert.ok(prompt.includes(`[아이 학년] ${fixture.gradeRaw}`), "프롬프트 학년 누락");

    if (fixture.expectedStatus === "SATISFIED") {
      assert.ok(prompt.includes("SATISFIED: 아이가 그 질문이 요구한 핵심 정보를 직접 제공한 경우"), "SATISFIED 기준 누락");
    } else if (fixture.expectedStatus === "PARTIAL") {
      assert.ok(prompt.includes("PARTIAL: 질문이 요구한 핵심 정보가 실제로 아직 빠진 경우에만 쓴다"), "PARTIAL 기준 누락");
      assert.ok(prompt.includes("이유가 빠짐"), "PARTIAL 이유 누락 예시 누락");
    }
  });
}
