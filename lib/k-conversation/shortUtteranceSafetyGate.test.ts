// 요청서 014 — 짧은 낱말에 안전 로직이 곧바로 발동하지 않는다. 단, 명백한 위험은 항상 발동한다.

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_DEFERRABLE_LENGTH,
  MAX_DEFERRALS_PER_CATEGORY,
  decideSafetyDeferral,
  isSingleShortWord,
  mustEscalateImmediately,
  resetSafetyDeferralsForTest,
} from "./shortUtteranceSafetyGate";

const decide = (sessionId: string, text: string, subcategory = "violence" as const) =>
  decideSafetyDeferral({ sessionId, text, subcategory });

test("014: 실제 오탐 낱말은 첫 발화에서 유예된다", () => {
  resetSafetyDeferralsForTest();
  // 2026-08-19 실측 오탐: 퀴즈 정답 "맞았어", 낱말 "굶주림"·"왕따"
  assert.equal(decide("s1", "맞았어").defer, true);
  assert.equal(decide("s3", "굶주림", "neglect").defer, true);
  assert.equal(decide("s4", "왕따").defer, true);
});

test("014: 성 안전·자해·협박은 낱말이어도 절대 유예하지 않는다", () => {
  // 명백 키워드가 짧다: "만졌"(3자), "더듬"(2자), "만지려"(3자).
  // 길이로 거르면 아이가 성 안전 피해를 한 단어로 말했을 때 그대로 묻힌다.
  resetSafetyDeferralsForTest();
  for (const [text, sub] of [
    ["만졌", "inappropriate_contact"],
    ["더듬", "inappropriate_contact"],
    ["만지려", "inappropriate_contact"],
    ["협박", "threat"],
    ["위협", "threat"],
  ] as const) {
    const decision = decideSafetyDeferral({ sessionId: "s", text, subcategory: sub });
    assert.equal(decision.defer, false, `유예되면 안 되는 범주가 유예됐다: ${text} (${sub})`);
    assert.equal(decision.reason, "not_deferrable_category");
  }
});

test("014: self_harm 은 유예 대상 범주가 아니다", () => {
  resetSafetyDeferralsForTest();
  const decision = decideSafetyDeferral({ sessionId: "s", text: "죽음", subcategory: "self_harm" });
  assert.equal(decision.defer, false);
});

test("014: 자살골·자책골은 유예가 아니라 탐지 단계에서 제외한다", async () => {
  // 유예는 "일단 넘어가고 반복되면 발동"이라 self_harm 에 쓰면 안 된다.
  // 축구 용어는 애초에 자해 신호가 아니므로 관용구 제외가 맞다.
  const { pickReaction } = await import("@/lib/freeChatReactions");
  assert.notEqual(pickReaction("자살골").category, "safety");
  assert.notEqual(pickReaction("자책골").category, "safety");
  // 진짜 신호는 그대로 잡힌다.
  assert.equal(pickReaction("자살").category, "safety");
  assert.equal(pickReaction("죽고싶어").category, "safety");
});

test("014: 명백한 위험 표현은 낱말이어도 절대 유예하지 않는다", () => {
  resetSafetyDeferralsForTest();
  for (const text of ["죽고싶어", "죽고 싶어", "자해", "자살", "사라지고싶어", "살기싫어", "죽어버릴래"]) {
    const decision = decideSafetyDeferral({ sessionId: "s", text, subcategory: "self_harm" });
    assert.equal(decision.defer, false, `유예되면 안 되는 표현이 유예됐다: ${text}`);
    assert.equal(decision.reason, "always_escalate");
  }
});

test("014: 문장으로 말하면 맥락이 있는 것이므로 그대로 발동한다", () => {
  resetSafetyDeferralsForTest();
  for (const text of [
    "친구가 나를 때렸어",
    "학교에서 애들이 나를 따돌려",
    "엄마가 밥을 안 줘서 굶었어",
  ]) {
    assert.equal(decide("s", text).defer, false, `문장인데 유예됐다: ${text}`);
  }
});

test("014: 같은 범주가 반복되면 낱말이라도 발동한다", () => {
  resetSafetyDeferralsForTest();
  assert.equal(decide("sess", "맞았어").defer, true);
  assert.equal(decide("sess", "때렸어").defer, true);
  // MAX_DEFERRALS_PER_CATEGORY 를 넘으면 더는 유예하지 않는다.
  assert.equal(MAX_DEFERRALS_PER_CATEGORY, 2);
  const third = decide("sess", "괴롭혀");
  assert.equal(third.defer, false);
  assert.equal(third.reason, "limit_reached");
});

test("014: 범주가 다르면 각각 센다", () => {
  resetSafetyDeferralsForTest();
  assert.equal(decide("s", "맞았어", "violence").defer, true);
  assert.equal(decide("s", "굶주림", "neglect").defer, true);
  assert.equal(decide("s", "때렸어", "violence").defer, true);
  assert.equal(decide("s", "괴롭혀", "violence").defer, false, "violence 는 2회를 넘겼다");
});

test("014: 같은 발화를 두 번 판정해도 횟수를 한 번만 쓴다", () => {
  // 한 턴에서 checkSafetyPreflight() 와 respond() 가 각각 부른다.
  resetSafetyDeferralsForTest();
  assert.equal(decide("turn", "맞았어").defer, true);
  assert.equal(decide("turn", "맞았어").defer, true, "같은 발화 재판정이 달라졌다");
  // 아직 한 번만 썼으므로 다른 낱말도 유예된다.
  assert.equal(decide("turn", "때렸어").defer, true);
  assert.equal(decide("turn", "괴롭혀").defer, false);
});

test("014: 세션이 다르면 서로 영향을 주지 않는다", () => {
  resetSafetyDeferralsForTest();
  decide("a", "맞았어");
  decide("a", "때렸어");
  assert.equal(decide("a", "괴롭혀").defer, false);
  assert.equal(decide("b", "괴롭혀").defer, true, "다른 세션이 영향을 받았다");
});

test("014: 낱말 판정 경계", () => {
  assert.equal(isSingleShortWord("맞았어"), true);
  assert.equal(isSingleShortWord("집에 혼자"), true, "두 어절까지는 낱말로 본다");
  assert.equal(isSingleShortWord("가".repeat(MAX_DEFERRABLE_LENGTH)), true);
  assert.equal(isSingleShortWord("가".repeat(MAX_DEFERRABLE_LENGTH + 1)), false);
  assert.equal(isSingleShortWord("나 오늘 맞았어"), false, "세 어절은 문장이다");
  assert.equal(isSingleShortWord("맞았어."), false, "마침표로 끝나면 서술문이다");
  assert.equal(isSingleShortWord(""), false);
});

test("014: 항상 발동 목록이 실제 자해 표현을 덮는다", () => {
  for (const text of ["죽고싶", "자해", "칼로 긋", "몸에 상처", "태어나지 말았"]) {
    assert.equal(mustEscalateImmediately(text), true, `누락: ${text}`);
  }
  // 낱말놀이에서 나올 법한 말은 여기 걸리지 않아야 한다.
  for (const text of ["맞았어", "자살골", "굶주림", "왕따", "기차"]) {
    assert.equal(mustEscalateImmediately(text), false, `과탐지: ${text}`);
  }
});

test("014: subcategory 가 없으면 유예하지 않는다", () => {
  resetSafetyDeferralsForTest();
  assert.equal(
    decideSafetyDeferral({ sessionId: "s", text: "맞았어", subcategory: undefined }).defer,
    false
  );
});

// ── 리뷰 반려 대응 (2026-08-19) ───────────────────────────────

test("014: 다음 턴에 같은 낱말을 또 말하면 새로 센다(무한 유예 금지)", () => {
  // 리뷰 HIGH: lastDeferredText 로 구분하면 아이가 "맞았어"를 반복할 때 영원히 유예됐다.
  resetSafetyDeferralsForTest();
  assert.equal(decideSafetyDeferral({ sessionId: "s", text: "맞았어", subcategory: "violence", turnId: "turn-1" }).defer, true);
  assert.equal(decideSafetyDeferral({ sessionId: "s", text: "맞았어", subcategory: "violence", turnId: "turn-2" }).defer, true);
  const third = decideSafetyDeferral({ sessionId: "s", text: "맞았어", subcategory: "violence", turnId: "turn-3" });
  assert.equal(third.defer, false, "같은 낱말이 세 턴째인데도 유예됐다");
  assert.equal(third.reason, "limit_reached");
});

test("014: 같은 턴 ID 는 횟수를 한 번만 쓴다", () => {
  resetSafetyDeferralsForTest();
  const opts = { sessionId: "s", text: "맞았어", subcategory: "violence" as const, turnId: "turn-1" };
  assert.equal(decideSafetyDeferral(opts).defer, true);
  assert.equal(decideSafetyDeferral(opts).defer, true);
  // 아직 1회만 썼으므로 다음 턴도 유예된다.
  assert.equal(
    decideSafetyDeferral({ ...opts, text: "때렸어", turnId: "turn-2" }).defer,
    true
  );
  assert.equal(
    decideSafetyDeferral({ ...opts, text: "괴롭혀", turnId: "turn-3" }).defer,
    false
  );
});

test("014: 1인칭 진술은 낱말이어도 유예하지 않는다", () => {
  // 리뷰 MEDIUM: "나 맞았어"는 낱말놀이가 아니라 자기 피해 진술이다.
  resetSafetyDeferralsForTest();
  for (const text of ["나 맞았어", "내가 맞았어", "날 때렸어", "저 맞았어", "우리 맞았어", "우릴 때렸어", "저희 맞았어"]) {
    const decision = decideSafetyDeferral({ sessionId: "s", text, subcategory: "violence" });
    assert.equal(decision.defer, false, `1인칭 진술이 유예됐다: ${text}`);
  }
  assert.equal(isSingleShortWord("나 맞았어"), false);
  assert.equal(isSingleShortWord("맞았어"), true);
});
