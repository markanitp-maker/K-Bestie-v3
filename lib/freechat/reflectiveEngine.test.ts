// 15개 카테고리 반영적 경청 엔진(classifyReflective/generateReflectiveReaction) 단위 테스트.
// node:test 내장 러너(npm test). LLM 미사용 규칙 기반 엔진이므로 순수 함수 검증만으로 충분하다.
// (lib/freechat/reactionEngine.test.ts는 기존 300여 개 seed 데이터 감사(audit) + 구 함수
//  classifyInput/pickReaction/getFreeChatReaction 전용 테스트라 이 파일과 분리했다.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyReflective, generateReflectiveReaction, type ReflectiveCategory } from "./reactionEngine.ts";

// 결정론적 난수(항상 0 반환) — 풀의 첫 후보를 고르고 후속 질문 임계값(<0.5)을 항상 통과시킨다.
const zeroRand = () => 0;

const ALL_CATEGORIES: ReflectiveCategory[] = [
  "scoldedByParent", "friendConflict", "resentment", "anger", "upset", "fear",
  "loneliness", "achievement", "joy", "excitement", "pain", "hungry", "tired",
  "boredom", "neutral",
];

// ── 15개 카테고리 대표 문장 분류 ────────────────────────────────────────
const REPRESENTATIVE: Array<{ text: string; expected: ReflectiveCategory }> = [
  { text: "나 오늘 기분 속상해", expected: "upset" },
  { text: "진짜 화나 죽겠어", expected: "anger" },
  { text: "나 억울해 진짜", expected: "resentment" },
  { text: "귀신 나올까봐 너무 무서워", expected: "fear" },
  { text: "혼자 있으니까 너무 외로워", expected: "loneliness" },
  { text: "나 너무 힘들어", expected: "tired" },
  { text: "나 배고파", expected: "hungry" },
  { text: "배가 너무 아파", expected: "pain" },
  { text: "친구랑 싸웠어", expected: "friendConflict" },
  { text: "엄마한테 혼났어", expected: "scoldedByParent" },
  { text: "선생님한테 칭찬받았어", expected: "achievement" },
  { text: "오늘 진짜 좋았어", expected: "joy" },
  { text: "너무 신나!", expected: "excitement" },
  { text: "너무 심심해", expected: "boredom" },
  { text: "그냥 오늘 평범했어", expected: "neutral" },
];

for (const { text, expected } of REPRESENTATIVE) {
  test(`classifyReflective: "${text}" -> ${expected}`, () => {
    const result = classifyReflective(text);
    assert.equal(result.category, expected);
  });
}

test("generateReflectiveReaction: 대표 문장마다 비어있지 않은 reflect+empathy(선택적 질문) 텍스트를 생성한다", () => {
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

// ── 부정 표현 처리 ──────────────────────────────────────────────────────
test("classifyReflective: '안 힘들어'는 tired로 오분류되지 않는다", () => {
  const result = classifyReflective("나 오늘 안 힘들어");
  assert.notEqual(result.category, "tired");
});

test("classifyReflective: '하나도 안 슬퍼'는 upset으로 오분류되지 않는다", () => {
  const result = classifyReflective("나 하나도 안 슬퍼");
  assert.notEqual(result.category, "upset");
});

test("classifyReflective: '힘들지 않아'(어미 부정)도 tired로 오분류되지 않는다", () => {
  const result = classifyReflective("오늘은 힘들지 않아");
  assert.notEqual(result.category, "tired");
});

// ── 혼합/복합 감정 문장 — 크래시 없이 합리적으로 처리 ─────────────────────
test("classifyReflective: 혼합 감정 문장도 크래시 없이 유효한 카테고리를 반환한다", () => {
  const result = classifyReflective("피곤한데 기분은 좋아");
  assert.ok(ALL_CATEGORIES.includes(result.category));
  const reaction = generateReflectiveReaction("피곤한데 기분은 좋아", [], { rand: zeroRand });
  assert.ok(reaction.text.length > 0);
});

// ── 저신뢰 ASR / 분류 불가 -> 중립 폴백(추측 금지) ────────────────────────
test("classifyReflective: 저신뢰 ASR이면 항상 neutral 폴백", () => {
  const result = classifyReflective("asdf 잘안들려 mumble", { isLowConfidenceAsr: true });
  assert.equal(result.category, "neutral");
  assert.equal(result.isLowConfidenceFallback, true);
});

test("generateReflectiveReaction: 저신뢰 ASR이면 구체적 내용을 지어내지 않고 중립 문구를 반환한다", () => {
  const reaction = generateReflectiveReaction("asdf 잘안들려 mumble", [], { isLowConfidenceAsr: true, rand: zeroRand });
  assert.equal(reaction.category, "neutral");
  assert.ok(reaction.text.length > 0);
});

// ── 위험 발화 문장도 이 엔진 자체는 크래시 없이 처리(실제 안전 라우팅 차단은
//    app/api/voice/respond/route.ts에서 pickReaction()이 먼저 처리하고 걸리면
//    이 엔진을 아예 호출하지 않는다 — 그 라우팅 순서 자체는 route.ts 레벨에서 보장됨) ──
test("classifyReflective: 위험 발화 문장도 크래시 없이 처리된다", () => {
  assert.doesNotThrow(() => classifyReflective("죽고 싶어"));
});

// ── 동일 문장 연속 반복 방지 ────────────────────────────────────────────
test("generateReflectiveReaction: 직전 케이 발화와 동일한 문장을 연속으로 반복하지 않는다(풀에 대안이 있을 때)", () => {
  const first = generateReflectiveReaction("나 오늘 기분 속상해", [], { rand: zeroRand });
  const second = generateReflectiveReaction("나 오늘 기분 속상해", [first.text], { rand: zeroRand });
  assert.notEqual(second.text, first.text);
});

test("generateReflectiveReaction: neutral 카테고리는 질문을 강제로 붙이지 않을 수 있다", () => {
  // rand가 항상 0.9를 반환하면(질문 임계값 0.5 초과) 질문이 절대 붙지 않아야 한다.
  const highRand = () => 0.9;
  const reaction = generateReflectiveReaction("그냥 오늘 평범했어", [], { rand: highRand });
  assert.equal(reaction.category, "neutral");
  assert.doesNotMatch(reaction.text, /\?$/);
});
