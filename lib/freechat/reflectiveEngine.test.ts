import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAndExtract, generateReflectiveReaction, type ReflectiveCategory, REPEAT_TEMPLATES, STOP_TEMPLATES, PASSIVE_TEMPLATES, UNCLEAR_AUDIO_TEMPLATES, APP_MODE_TEMPLATES } from "./reactionEngine";

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

// 저신뢰 ASR 및 1글자 발화
test("classifyAndExtract: 저신뢰 ASR이면 항상 unclear_audio", () => {
  const result = classifyAndExtract("asdf 잘안들려 mumble", { isLowConfidenceAsr: true });
  assert.equal(result.category, "unclear_audio");
});

test("classifyAndExtract: isLowConfidenceAsr: true이면 1글자든 아니든 unclear_audio (기존 동작 유지)", () => {
  assert.equal(classifyAndExtract("응", { isLowConfidenceAsr: true }).category, "unclear_audio");
  assert.equal(classifyAndExtract("어", { isLowConfidenceAsr: true }).category, "unclear_audio");
  assert.equal(classifyAndExtract("네", { isLowConfidenceAsr: true }).category, "unclear_audio");
});

test("classifyAndExtract: '응'·'어'·'네' 등 의미 있는 1글자는 unclear_audio가 아니다 (2026-08-18 사고 수정)", () => {
  assert.notEqual(classifyAndExtract("응").category, "unclear_audio");
  assert.notEqual(classifyAndExtract("어").category, "unclear_audio");
  assert.notEqual(classifyAndExtract("네").category, "unclear_audio");
  assert.notEqual(classifyAndExtract("예").category, "unclear_audio");
  assert.notEqual(classifyAndExtract("왜").category, "unclear_audio");
  assert.notEqual(classifyAndExtract("뭐").category, "unclear_audio");
  assert.notEqual(classifyAndExtract("음").category, "unclear_audio");
});

test("classifyAndExtract: 빈 문자열이나 의미 없는 1글자(ㅋ, 기호)는 여전히 unclear_audio", () => {
  assert.equal(classifyAndExtract("").category, "unclear_audio");
  assert.equal(classifyAndExtract("   ").category, "unclear_audio");
  assert.equal(classifyAndExtract("ㅋ").category, "unclear_audio");
  assert.equal(classifyAndExtract("ㅎ").category, "unclear_audio");
  assert.equal(classifyAndExtract("?").category, "unclear_audio");
});

test("generateReflectiveReaction: 저신뢰 ASR이면 구체적 내용을 지어내지 않는다", () => {
  const reaction = generateReflectiveReaction("asdf 잘안들려 mumble", [], { isLowConfidenceAsr: true, rand: zeroRand });
  assert.equal(reaction.category, "unclear_audio");
  assert.equal(reaction.text, "말을 잘 못 알아들었어. 다시 말해도 괜찮아.");
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

// 1. 3개 예시 매핑 및 과잉 일반화 방지 테스트
test("generateReflectiveReaction: 대표님 지정 3개 매핑 최종 출력 텍스트 검증 및 부정어 회귀 테스트", () => {
  const r1 = generateReflectiveReaction("너무 많이 반복해", [], { rand: zeroRand });
  assert.ok(REPEAT_TEMPLATES.includes(r1.text), `비정상 문장 생성: ${r1.text}`);
  
  const r2 = generateReflectiveReaction("이제 그만해", [], { rand: zeroRand });
  assert.ok(STOP_TEMPLATES.includes(r2.text), `비정상 문장 생성: ${r2.text}`);
  
  const r3 = generateReflectiveReaction("수동으로 해줘", [], { rand: zeroRand });
  assert.ok(PASSIVE_TEMPLATES.includes(r3.text), `비정상 문장 생성: ${r3.text}`);

  // 부정문 오추론 방지 회귀 테스트
  const r4 = generateReflectiveReaction("자동 안내가 싫어", [], { rand: zeroRand });
  assert.equal(r4.text, "자동 안내가 싫었구나.");
});

// 2. neutral 특수 분기의 반복 방지
test("generateReflectiveReaction: neutral_statement 템플릿 반복 방지 동작 (20턴 회피 검증)", () => {
  const history: string[] = [];
  for (let i = 0; i < 20; i++) {
    const res = generateReflectiveReaction("수동 싫어", history, { rand: zeroRand });
    assert.ok(!history.includes(res.text), `중복 발생: ${res.text} (턴: ${i})`);
    history.push(res.text);
  }
});

// 3. 3개 특수 매핑에 대한 반복 방지
test("generateReflectiveReaction: 3개 특수 매핑 응답도 반복 방지가 적용됨 (20턴 회피 검증)", () => {
  const history: string[] = [];
  for (let i = 0; i < 20; i++) {
    const res = generateReflectiveReaction("너무 많이 반복해", history, { rand: zeroRand });
    assert.ok(!history.includes(res.text), `중복 발생: ${res.text} (턴: ${i})`);
    assert.ok(REPEAT_TEMPLATES.includes(res.text), `비정상 문장 생성: ${res.text}`);
    history.push(res.text);
  }
});

test("generateReflectiveReaction: unclear_audio 반복 방지 동작 (20턴 회피 검증)", () => {
  const history: string[] = [];
  for (let i = 0; i < 20; i++) {
    const res = generateReflectiveReaction("asdf 잘안들려 mumble", history, { isLowConfidenceAsr: true, rand: zeroRand });
    assert.ok(!history.includes(res.text), `중복 발생: ${res.text} (턴: ${i})`);
    assert.ok(UNCLEAR_AUDIO_TEMPLATES.includes(res.text), `비정상 문장 생성: ${res.text}`);
    history.push(res.text);
  }
});

test("generateReflectiveReaction: app_mode_question 반복 방지 동작 (20턴 회피 검증)", () => {
  const history: string[] = [];
  for (let i = 0; i < 20; i++) {
    const res = generateReflectiveReaction("레고 수동으로 동작해?", history, { rand: zeroRand });
    assert.ok(!history.includes(res.text), `중복 발생: ${res.text} (턴: ${i})`);
    assert.ok(APP_MODE_TEMPLATES.includes(res.text), `비정상 문장 생성: ${res.text}`);
    history.push(res.text);
  }
});

// 4. '그랬구나' 단독 응답 및 제네릭 fallback 금지 확인, fail-closed 동작 확인
test("generateReflectiveReaction: 단독 제네릭 응답 금지 및 fail-closed 처리", () => {
  // extracted가 너무 길어서 null이 되는 경우 (unclear_audio로 fail-closed 되어야 함)
  const res = generateReflectiveReaction("이건정말아주많이매우엄청나게긴중립문장입니다", [], { rand: zeroRand });
  assert.equal(res.category, "unclear_audio");
  assert.equal(res.text, "말을 잘 못 알아들었어. 다시 말해도 괜찮아.");
  
  // 전체 대표 샘플에 대해 "그런 마음이었구나." 또는 "그랬구나."(단독)이 나오지 않음을 확인
  for (const { text } of REPRESENTATIVE) {
    const reaction = generateReflectiveReaction(text, [], { rand: zeroRand });
    assert.notEqual(reaction.text, "그런 마음이었구나.");
    assert.notEqual(reaction.text, "그랬구나.");
  }
});
