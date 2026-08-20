import { describe, it } from "node:test";
import assert from "node:assert";
import {
  getVocativeParticle,
  appendVocative,
  topicParticle,
  subjectParticle,
  objectParticle,
  instrumentalParticle,
  quotativeParticle,
} from "./koreanParticle";

describe("koreanParticle utility", () => {
  it("should return 아 for names with jongseong", () => {
    assert.strictEqual(getVocativeParticle("서현"), "아");
    assert.strictEqual(getVocativeParticle("준호형"), "아");
  });

  it("should return 야 for names without jongseong", () => {
    assert.strictEqual(getVocativeParticle("서아"), "야");
    assert.strictEqual(getVocativeParticle("철수"), "야");
  });

  it("should correctly append vocative particle", () => {
    assert.strictEqual(appendVocative("서현"), "서현아");
    assert.strictEqual(appendVocative("서아"), "서아야");
    assert.strictEqual(appendVocative(""), "");
    assert.strictEqual(appendVocative(null), "");
  });

  it("should fallback to 야 for non-korean names", () => {
    assert.strictEqual(getVocativeParticle("John"), "야");
    assert.strictEqual(appendVocative("John"), "John야");
  });
});

// 010 (2026-08-20 Dev QA 실측) — 끝말잇기 문장에 `(은)는`, `(으)로` 자리표시자가 그대로
// 남아 아이 화면에 찍혔다. 조사를 확정하는 함수들.
describe("조사 확정 (010)", () => {
  it("은/는 — 받침 유무로 갈린다", () => {
    assert.strictEqual(topicParticle("전기"), "는");
    assert.strictEqual(topicParticle("과제"), "는");
    assert.strictEqual(topicParticle("유리"), "는");
    assert.strictEqual(topicParticle("제빵사"), "는");
    assert.strictEqual(topicParticle("수박"), "은");
    assert.strictEqual(topicParticle("거북이"), "는");
    assert.strictEqual(topicParticle("김치전"), "은");
  });

  it("이/가, 을/를", () => {
    assert.strictEqual(subjectParticle("수박"), "이");
    assert.strictEqual(subjectParticle("사과"), "가");
    assert.strictEqual(objectParticle("수박"), "을");
    assert.strictEqual(objectParticle("사과"), "를");
  });

  it("으로/로 — 받침 없거나 ㄹ 받침이면 '로'", () => {
    assert.strictEqual(instrumentalParticle("과제"), "로");
    assert.strictEqual(instrumentalParticle("제빵사"), "로");
    assert.strictEqual(instrumentalParticle("서울"), "로");
    assert.strictEqual(instrumentalParticle("연필"), "로");
    assert.strictEqual(instrumentalParticle("수박"), "으로");
    assert.strictEqual(instrumentalParticle("과"), "로");
    assert.strictEqual(instrumentalParticle("공"), "으로");
  });

  it("따옴표가 붙어 있어도 마지막 글자를 본다", () => {
    assert.strictEqual(topicParticle('"전기"'), "는");
    assert.strictEqual(instrumentalParticle("'수박'"), "으로");
  });

  it("한글이 아니면 기본형으로 떨어진다", () => {
    assert.strictEqual(topicParticle("apple"), "는");
    assert.strictEqual(instrumentalParticle("apple"), "로");
    assert.strictEqual(topicParticle(""), "는");
  });
});

describe("2026-08-20 QA 실측 — 조사 보정", () => {
  it("2026-08-20 QA 실측 — 케이가 조사를 틀렸다", () => {
    // 실측 문구:
    //   케이: 아쉽다, "헐"는 아니야!            → "헐"은
    //   케이: 내가 "땀"라고 들었는데, 이게 맞니?  → "땀"이라고
    assert.equal(`"헐"${topicParticle("헐")}`, '"헐"은');
    assert.equal(`"땀"${quotativeParticle("땀")}`, '"땀"이라고');

    // 받침 없는 낱말은 그대로다.
    assert.equal(`"사과"${topicParticle("사과")}`, '"사과"는');
    assert.equal(`"코끼리"${quotativeParticle("코끼리")}`, '"코끼리"라고');
  });

  it("따옴표가 붙어 있어도 마지막 글자로 판단한다", () => {
    // 호출부가 따옴표째 넘기는 경우가 있다.
    assert.equal(quotativeParticle('"땀"'), "이라고");
    assert.equal(topicParticle('"헐"'), "은");
  });

  it("한글이 아니면 받침 없는 쪽을 쓴다", () => {
    for (const w of ["OK", "123", ""]) {
      assert.equal(quotativeParticle(w), "라고", w);
      assert.equal(topicParticle(w), "는", w);
    }
  });
});
