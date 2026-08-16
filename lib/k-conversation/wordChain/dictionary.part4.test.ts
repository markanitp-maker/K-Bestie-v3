import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DICTIONARY_PART4 } from "./dictionary.part4";
import { DICTIONARY_PART1 } from "./dictionary.part1";
import { DICTIONARY_PART2 } from "./dictionary.part2";
import { DICTIONARY_PART3 } from "./dictionary.part3";
import { validateWordChainDictionary } from "./dictionaryValidator";
import { deriveWordChainEntry } from "./dictionaryTypes";
import { lookupWord, WORD_CHAIN_DICTIONARY } from "./dictionaryIndex";

describe("WordChain Dictionary Part 4 — 핵심 기본어 보강", () => {
  it("DICTIONARY_PART4는 검증기(validateWordChainDictionary)를 이슈 0건으로 통과해야 한다", () => {
    const issues = validateWordChainDictionary(DICTIONARY_PART4);
    assert.deepEqual(issues, [], "검증기 위반 항목: " + JSON.stringify(issues, null, 2));
  });

  it("단어 수가 300~400개 범위여야 한다 (현재 360개)", () => {
    assert.ok(DICTIONARY_PART4.length >= 300 && DICTIONARY_PART4.length <= 400, "단어 수 범위 벗어남: " + DICTIONARY_PART4.length);
    assert.equal(DICTIONARY_PART4.length, 360);
  });

  it("Part 1, Part 2, Part 3 단어와의 중복이 0건이어야 한다", () => {
    const part1Words = new Set(DICTIONARY_PART1.map((e) => e.word));
    const part2Words = new Set(DICTIONARY_PART2.map((e) => e.word));
    const part3Words = new Set(DICTIONARY_PART3.map((e) => e.word));
    const duplicates: string[] = [];

    for (const entry of DICTIONARY_PART4) {
      if (part1Words.has(entry.word) || part2Words.has(entry.word) || part3Words.has(entry.word)) {
        duplicates.push(entry.word);
      }
    }

    assert.deepEqual(duplicates, [], "기존 사전(Part 1~3)과 중복되는 단어: " + duplicates.join(", "));
  });

  it("45개 핵심 누락어가 DICTIONARY_PART4에 전수 포함되고 lookupWord로 모두 정상 조회되어야 한다", () => {
    const missingCoreWords = [
      "학교", "집", "물", "밥", "책", "공", "손", "발", "눈", "코", "입", "귀",
      "산", "강", "별", "달", "해", "불", "문", "시간", "나무", "이름", "다리",
      "노래", "그림", "여름", "겨울", "봄", "가을", "우리", "나라", "도시", "마을",
      "시장", "공기", "소리", "색깔", "모양", "숫자", "글자", "사진", "영화", "만화",
      "게임", "형"
    ];

    assert.equal(missingCoreWords.length, 45);

    const part4WordSet = new Set(DICTIONARY_PART4.map((e) => e.word));
    const notInPart4: string[] = [];

    for (const word of missingCoreWords) {
      if (!part4WordSet.has(word)) {
        notInPart4.push(word);
      }
      const entry = lookupWord(word);
      assert.ok(entry, "lookupWord 실패: " + word);
      assert.equal(entry.normalizedWord, word);
    }

    assert.deepEqual(notInPart4, [], "Part4에 누락된 핵심 단어: " + notInPart4.join(", "));
  });

  it("1음절 단어 비율이 전체의 25% 이하여야 한다", () => {
    const oneSyllableCount = DICTIONARY_PART4.filter((e) => e.word.length === 1).length;
    const ratio = oneSyllableCount / DICTIONARY_PART4.length;
    const percentage = (ratio * 100).toFixed(2);

    console.log("[Part 4 1음절 통계] 1음절 개수: " + oneSyllableCount + "/" + DICTIONARY_PART4.length + " (" + percentage + "%)");

    assert.ok(
      ratio <= 0.25,
      "1음절 단어 비율(" + percentage + "%)이 25%를 초과합니다 (" + oneSyllableCount + "/" + DICTIONARY_PART4.length + ")"
    );
  });

  it("Part 4 마지막 음절 최다 비율이 15% 이하여야 한다", () => {
    const lastSyllableCounts = new Map<string, number>();
    for (const entry of DICTIONARY_PART4) {
      const derived = deriveWordChainEntry(entry);
      const last = derived.lastSyllable;
      lastSyllableCounts.set(last, (lastSyllableCounts.get(last) ?? 0) + 1);
    }

    let maxCount = 0;
    let mostFrequentSyllable = "";
    for (const [syllable, count] of lastSyllableCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        mostFrequentSyllable = syllable;
      }
    }

    const maxRatio = maxCount / DICTIONARY_PART4.length;
    const maxRatioPercentage = (maxRatio * 100).toFixed(2);

    console.log(
      "[Part 4 마지막 음절 통계] 최다 음절: " + mostFrequentSyllable + " (" + maxCount + "건, " + maxRatioPercentage + "%)"
    );

    assert.ok(
      maxRatio <= 0.15,
      "Part 4 최다 마지막 음절(" + mostFrequentSyllable + ") 비율이 15%를 초과합니다: " + maxRatioPercentage + "%"
    );
  });

  it("전체 사전(Part 1~4 통합) 기준 마지막 음절 최다 비율이 15% 이하여야 한다", () => {
    const lastSyllableCounts = new Map<string, number>();
    for (const entry of WORD_CHAIN_DICTIONARY) {
      const last = entry.lastSyllable;
      lastSyllableCounts.set(last, (lastSyllableCounts.get(last) ?? 0) + 1);
    }

    let maxCount = 0;
    let mostFrequentSyllable = "";
    for (const [syllable, count] of lastSyllableCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        mostFrequentSyllable = syllable;
      }
    }

    const maxRatio = maxCount / WORD_CHAIN_DICTIONARY.length;
    const maxRatioPercentage = (maxRatio * 100).toFixed(2);

    console.log(
      "[통합 사전 마지막 음절 통계] 총 단어: " + WORD_CHAIN_DICTIONARY.length + ", 최다 음절: " + mostFrequentSyllable + " (" + maxCount + "건, " + maxRatioPercentage + "%)"
    );

    assert.ok(
      maxRatio <= 0.15,
      "통합 사전 최다 마지막 음절(" + mostFrequentSyllable + ") 비율이 15%를 초과합니다: " + maxRatioPercentage + "%"
    );
  });
});
