import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAndExtract, generateReflectiveReaction, type ReflectiveCategory } from "./reactionEngine";

const zeroRand = () => 0;

const ALL_CATEGORIES: ReflectiveCategory[] = [
  "emotion_disclosure",
  "event_story",
  "positive_experience",
  "physical_need",
  "preference_interest",
  "direct_question",
  "app_mode_question",
  "unclear_audio",
  "safety_signal",
  "neutral_statement"
];

const REPRESENTATIVE: Array<{ text: string; expected: ReflectiveCategory }> = [
  { text: "나 오늘 기분 속상해", expected: "emotion_disclosure" },
  { text: "진짜 화나 죽겠어", expected: "emotion_disclosure" },
  { text: "나 너무 힘들어", expected: "neutral_statement" }, // 미분류 입력은 neutral_statement로 처리
  { text: "나 배고파", expected: "physical_need" },
  { text: "배가 너무 아파", expected: "physical_need" },
  { text: "친구랑 놀았어", expected: "event_story" },
  { text: "오늘 진짜 좋았어", expected: "positive_experience" },
  { text: "너무 신나!", expected: "emotion_disclosure" }, // '신나' is in EMOTION_KWS or POSITIVE_KWS. Let's check which one matches first. Emotion!
  { text: "사과가 좋아", expected: "positive_experience" }, // '좋아' is in POSITIVE_KWS
  { text: "사과가 예쁘다", expected: "preference_interest" }, // 예쁘
  { text: "왜 하늘은 파란색이야?", expected: "direct_question" },
  { text: "레고 수동으로 동작해?", expected: "app_mode_question" },
];

for (const { text, expected } of REPRESENTATIVE) {
  test(`classifyAndExtract: "${text}" -> ${expected}`, () => {
    const result = classifyAndExtract(text);
    assert.equal(result.category, expected);
  });
}

test("generateReflectiveReaction: 생성 텍스트는 빈 문자열이 아니다", () => {
  for (const { text } of REPRESENTATIVE) {
    const reaction = generateReflectiveReaction(text, [], { rand: zeroRand });
    assert.ok(reaction.text.length > 0);
  }
});

test("generateReflectiveReaction: 금지된 추궁형 질문('왜 그랬어?')을 포함하지 않는다", () => {
  for (const { text } of REPRESENTATIVE) {
    const reaction = generateReflectiveReaction(text, [], { rand: zeroRand });
    assert.doesNotMatch(reaction.text, /왜\s*그랬/);
  }
});

// 혼합/복합 감정 문장
test("classifyAndExtract: 복합 문장도 크래시 없이 유효한 카테고리를 반환한다", () => {
  const result = classifyAndExtract("피곤한데 기분은 좋아");
  assert.ok(ALL_CATEGORIES.includes(result.category));
  const reaction = generateReflectiveReaction("피곤한데 기분은 좋아", [], { rand: zeroRand });
  assert.ok(reaction.text.length > 0);
});

// 저신뢰 ASR
test("classifyAndExtract: 저신뢰 ASR이면 항상 unclear_audio", () => {
  const result = classifyAndExtract("asdf 잘안들려 mumble", { isLowConfidenceAsr: true });
  assert.equal(result.category, "unclear_audio");
});

test("generateReflectiveReaction: 저신뢰 ASR이면 구체적 내용을 지어내지 않는다", () => {
  const reaction = generateReflectiveReaction("asdf 잘안들려 mumble", [], { isLowConfidenceAsr: true, rand: zeroRand });
  assert.equal(reaction.category, "unclear_audio");
  assert.equal(reaction.text, "말을 잘 못 알아들었어. 천천히 다시 말해도 괜찮아.");
});

// 동일 문장 반복 방지
test("generateReflectiveReaction: 반복 방지 로직 동작", () => {
  const first = generateReflectiveReaction("나 오늘 기분 속상해", [], { rand: zeroRand });
  const second = generateReflectiveReaction("나 오늘 기분 속상해", [first.text], { rand: () => 0.99 });
  // Since pool has more than 1 option, it should pick the other one
  assert.notEqual(second.text, first.text);
});

// app_mode_question
test("generateReflectiveReaction: app_mode_question 반환 확인", () => {
  const reaction = generateReflectiveReaction("레고 수동으로 동작해?", [], { rand: zeroRand });
  assert.equal(reaction.category, "app_mode_question");
  assert.equal(reaction.text, "그건 잘 모르겠어.");
});
