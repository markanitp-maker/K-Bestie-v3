import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { judgeChildWord } from "./chainRules";
import { lookupWord } from "./dictionaryIndex";

describe("WordChain Judgement Rules (chainRules)", () => {
  const previousBag = lookupWord("가방")!; // lastSyllable: '방'
  const previousForsythia = lookupWord("개나리")!; // lastSyllable: '리' (두음: '리', '이')

  it("빈 문자열 또는 공백 입력 -> EMPTY 거부", () => {
    assert.deepEqual(
      judgeChildWord({
        raw: "",
        previousWord: null,
        usedWords: new Set(),
      }),
      { accepted: false, rejection: "EMPTY" }
    );

    assert.deepEqual(
      judgeChildWord({
        raw: "   ",
        previousWord: previousBag,
        usedWords: new Set(),
      }),
      { accepted: false, rejection: "EMPTY" }
    );
  });

  it("영문/숫자/자모 단독/특수문자 -> NOT_HANGUL 거부", () => {
    // 영문
    assert.deepEqual(
      judgeChildWord({
        raw: "apple",
        previousWord: null,
        usedWords: new Set(),
      }),
      { accepted: false, rejection: "NOT_HANGUL" }
    );

    // 숫자
    assert.deepEqual(
      judgeChildWord({
        raw: "123",
        previousWord: null,
        usedWords: new Set(),
      }),
      { accepted: false, rejection: "NOT_HANGUL" }
    );

    // 자모 단독
    assert.deepEqual(
      judgeChildWord({
        raw: "ㄱㄴㄷ",
        previousWord: null,
        usedWords: new Set(),
      }),
      { accepted: false, rejection: "NOT_HANGUL" }
    );

    // 한글 + 영문 혼합
    assert.deepEqual(
      judgeChildWord({
        raw: "가방a",
        previousWord: null,
        usedWords: new Set(),
      }),
      { accepted: false, rejection: "NOT_HANGUL" }
    );
  });

  it("사전에 없는 단어 -> NOT_IN_DICTIONARY 거부", () => {
    assert.deepEqual(
      judgeChildWord({
        raw: "방사능외계어",
        previousWord: previousBag,
        usedWords: new Set(),
      }),
      { accepted: false, rejection: "NOT_IN_DICTIONARY" }
    );

    // 오타(사전 단어와 1글자 다른 단어)는 자동 fuzzy 인정 없이 거부되어야 함 (§3-14)
    assert.deepEqual(
      judgeChildWord({
        raw: "가지개", // '무지개'의 오타
        previousWord: null,
        usedWords: new Set(),
      }),
      { accepted: false, rejection: "NOT_IN_DICTIONARY" }
    );
  });

  it("이미 사용된 단어 -> ALREADY_USED 거부", () => {
    const usedWords = new Set(["가방", "방학"]);
    const res = judgeChildWord({
      raw: "방학",
      previousWord: previousBag,
      usedWords,
    });
    assert.equal(res.accepted, false);
    assert.equal(res.rejection, "ALREADY_USED");
  });

  it("끝말이 일치하지 않는 단어 -> CHAIN_MISMATCH 거부", () => {
    // 직전 단어가 '가방'(끝: '방')인데 '사과'(시작: '사')를 입력
    const res = judgeChildWord({
      raw: "사과",
      previousWord: previousBag,
      usedWords: new Set(),
    });
    assert.equal(res.accepted, false);
    assert.equal(res.rejection, "CHAIN_MISMATCH");
  });

  it("판정 순서 검증: 사전에 없는 단어는 usedWords에 있어도 ALREADY_USED가 아닌 NOT_IN_DICTIONARY로 판정되어야 한다", () => {
    // '가짜단어'가 usedWords에 들어있더라도 사전에 없으므로 NOT_IN_DICTIONARY여야 함
    const usedWords = new Set(["가짜단어"]);
    const res = judgeChildWord({
      raw: "가짜단어",
      previousWord: null,
      usedWords,
    });
    assert.equal(res.accepted, false);
    assert.equal(res.rejection, "NOT_IN_DICTIONARY");
  });

  it("판정 순서 검증: 사전에 없는 단어는 끝말이 안 맞아도 CHAIN_MISMATCH가 아닌 NOT_IN_DICTIONARY로 판정되어야 한다", () => {
    const res = judgeChildWord({
      raw: "가짜단어",
      previousWord: previousBag,
      usedWords: new Set(),
    });
    assert.equal(res.accepted, false);
    assert.equal(res.rejection, "NOT_IN_DICTIONARY");
  });

  it("정상 단어 및 첫 턴 단어 통과", () => {
    // 첫 턴 (previousWord: null)
    const firstTurn = judgeChildWord({
      raw: "가방",
      previousWord: null,
      usedWords: new Set(),
    });
    assert.equal(firstTurn.accepted, true);
    assert.ok(firstTurn.entry);
    assert.equal(firstTurn.entry.word, "가방");

    // 정상 연결 ('가방' -> '방학')
    const secondTurn = judgeChildWord({
      raw: "방학",
      previousWord: previousBag,
      usedWords: new Set(["가방"]),
    });
    assert.equal(secondTurn.accepted, true);
    assert.ok(secondTurn.entry);
    assert.equal(secondTurn.entry.word, "방학");
  });

  it("두음법칙 적용된 정상 연결 통과 ('개나리' -> '이슬')", () => {
    // '개나리'의 끝 음절 '리' -> 두음법칙으로 '이' 허용 ('이슬' 시작: '이')
    const duEumTurn = judgeChildWord({
      raw: "이슬",
      previousWord: previousForsythia,
      usedWords: new Set(["개나리"]),
    });
    assert.equal(duEumTurn.accepted, true);
    assert.ok(duEumTurn.entry);
    assert.equal(duEumTurn.entry.word, "이슬");
  });
});
