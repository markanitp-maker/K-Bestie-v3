import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateWordChainDictionary, FORBIDDEN_KEYWORDS } from "./dictionaryValidator";
import { WordChainEntry } from "./dictionaryTypes";

describe("WordChain Dictionary Validator", () => {
  it("정상적인 단어 목록은 이슈 없이 통과해야 한다", () => {
    const validEntries: WordChainEntry[] = [
      { word: "사과", difficulty: 1, category: "음식" },
      { word: "바나나", difficulty: 1, category: "음식" },
      { word: "호랑이", difficulty: 2, category: "동물" },
      { word: "초등학교", difficulty: 2, category: "학교생활" },
      { word: "해바라기", difficulty: 3, category: "식물", acceptedAliases: ["해바라기꽃"] },
    ];

    const issues = validateWordChainDictionary(validEntries);
    assert.equal(issues.length, 0, `예상치 못한 이슈: ${JSON.stringify(issues)}`);
  });

  it("중복된 단어(정규화 기준)를 검출해야 한다", () => {
    const duplicateEntries: WordChainEntry[] = [
      { word: "사과", difficulty: 1 },
      { word: "사과", difficulty: 1 },
    ];
    const issues = validateWordChainDictionary(duplicateEntries);
    assert.equal(issues.length, 1);
    assert.match(issues[0].reason, /중복된 단어/);
  });

  it("한글 완성형 음절이 아닌 문자(자모, 영문, 숫자, 특수문자, 공백)를 검출해야 한다", () => {
    const invalidCharEntries: WordChainEntry[] = [
      { word: "apple", difficulty: 1 },
      { word: "사과123", difficulty: 1 },
      { word: "사과!", difficulty: 1 },
      { word: "ㅅㅏㄱㅘ", difficulty: 1 },
      { word: "사 과", difficulty: 1 },
    ];
    const issues = validateWordChainDictionary(invalidCharEntries);
    assert.ok(issues.length >= 5);
  });

  it("난이도(difficulty)가 1~6 정수가 아닌 경우를 검출해야 한다", () => {
    const invalidDifficultyEntries: WordChainEntry[] = [
      { word: "사과", difficulty: 0 },
      { word: "포도", difficulty: 7 },
      { word: "수박", difficulty: 2.5 },
      { word: "참외", difficulty: -1 },
    ];
    const issues = validateWordChainDictionary(invalidDifficultyEntries);
    assert.equal(issues.length, 4);
    for (const issue of issues) {
      assert.match(issue.reason, /난이도\(difficulty\)/);
    }
  });

  it("금지어(비속어/성인/폭력 등) 부분 문자열 매칭 시 검출해야 한다", () => {
    const forbiddenEntries: WordChainEntry[] = [
      { word: "개새끼", difficulty: 1 },
      { word: "시발점", difficulty: 3 }, // '시발' 포함
      { word: "야동보기", difficulty: 1 },
      { word: "살인사건", difficulty: 4 },
      { word: "자살시도", difficulty: 4 },
      { word: "대마초농장", difficulty: 5 },
    ];
    const issues = validateWordChainDictionary(forbiddenEntries);
    assert.equal(issues.length, forbiddenEntries.length);
    for (const issue of issues) {
      assert.match(issue.reason, /금지어 키워드/);
    }
  });

  it("동사/형용사 파생 접미사(~하다, ~되다, ~스럽다, ~롭다, ~답다 등)를 검출해야 한다", () => {
    const verbEntries: WordChainEntry[] = [
      { word: "공부하다", difficulty: 2 },
      { word: "발전되다", difficulty: 3 },
      { word: "사랑스럽다", difficulty: 3 },
      { word: "평화롭다", difficulty: 3 },
      { word: "어른답다", difficulty: 3 },
      { word: "감동시키다", difficulty: 4 },
    ];
    const issues = validateWordChainDictionary(verbEntries);
    assert.equal(issues.length, verbEntries.length);
    for (const issue of issues) {
      assert.match(issue.reason, /동사\/형용사/);
    }
  });

  it("용언 종결/연결 어미(~했다, ~어요, ~아요, ~는다, ~잖아 등)를 검출해야 한다", () => {
    const endingEntries: WordChainEntry[] = [
      { word: "먹었다", difficulty: 1 },
      { word: "달린다", difficulty: 1 },
      { word: "좋아요", difficulty: 1 },
      { word: "예쁘네요", difficulty: 2 },
      { word: "멋지잖아", difficulty: 2 },
    ];
    const issues = validateWordChainDictionary(endingEntries);
    assert.equal(issues.length, endingEntries.length);
    for (const issue of issues) {
      assert.match(issue.reason, /어미/);
    }
  });

  it("2음절 이상 조사 결합(~처럼, ~만큼, ~에서, ~에게 등)을 검출해야 한다", () => {
    const particleEntries: WordChainEntry[] = [
      { word: "하늘처럼", difficulty: 2 },
      { word: "학교에서", difficulty: 2 },
      { word: "친구에게", difficulty: 2 },
      { word: "집으로", difficulty: 1 },
    ];
    const issues = validateWordChainDictionary(particleEntries);
    assert.equal(issues.length, particleEntries.length);
    for (const issue of issues) {
      assert.match(issue.reason, /조사/);
    }
  });

  it("acceptedAliases의 유효성(원본과 동일, 중복, 금지어, 비한글)을 검출해야 한다", () => {
    const aliasIssueEntries: WordChainEntry[] = [
      { word: "사과", difficulty: 1, acceptedAliases: ["사과"] }, // 원본과 동일
      { word: "포도", difficulty: 1, acceptedAliases: ["청포도", "청포도"] }, // 별칭 간 중복
      { word: "수박", difficulty: 1, acceptedAliases: ["watermelon"] }, // 비한글
      { word: "참외", difficulty: 1, acceptedAliases: ["개새끼참외"] }, // 금지어 포함
    ];
    const issues = validateWordChainDictionary(aliasIssueEntries);
    assert.equal(issues.length, 4);
  });
});
