import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DICTIONARY_PART2 } from "./dictionary.part2";
import { DICTIONARY_PART1 } from "./dictionary.part1";
import { validateWordChainDictionary } from "./dictionaryValidator";
import { deriveWordChainEntry } from "./dictionaryTypes";

describe("WordChain Dictionary Part 2", () => {
  it("DICTIONARY_PART2는 검증기(validateWordChainDictionary)를 이슈 0건으로 통과해야 한다", () => {
    const issues = validateWordChainDictionary(DICTIONARY_PART2);
    assert.deepEqual(issues, [], `검증기 위반 항목: ${JSON.stringify(issues, null, 2)}`);
  });

  it("단어 수가 300개 이상이어야 한다 (현재 380개)", () => {
    assert.ok(DICTIONARY_PART2.length >= 300, `단어 수가 부족합니다: ${DICTIONARY_PART2.length}`);
    assert.equal(DICTIONARY_PART2.length, 380, `현재 등록 단어 수: ${DICTIONARY_PART2.length}`);
  });

  it("모든 단어는 2음절 이상이어야 한다 (1음절 단어 제외)", () => {
    for (const entry of DICTIONARY_PART2) {
      assert.ok(
        entry.word.length >= 2,
        `2음절 미만 단어가 발견되었습니다: ${entry.word}`
      );
    }
  });

  it("모든 단어의 deriveWordChainEntry 파생값(첫음절, 끝음절, 정규화)이 일치해야 한다", () => {
    for (const entry of DICTIONARY_PART2) {
      const derived = deriveWordChainEntry(entry);
      assert.equal(derived.normalizedWord, entry.word);
      assert.equal(derived.firstSyllable, entry.word.slice(0, 1));
      assert.equal(derived.lastSyllable, entry.word.slice(-1));
      assert.equal(derived.firstSyllable.length, 1);
      assert.equal(derived.lastSyllable.length, 1);
    }
  });

  it("마지막 음절 분포: 최다 마지막 음절 비율이 전체의 15%를 넘지 않아야 한다", () => {
    const lastSyllableCounts = new Map<string, number>();
    for (const entry of DICTIONARY_PART2) {
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

    const maxRatio = maxCount / DICTIONARY_PART2.length;
    const maxRatioPercentage = (maxRatio * 100).toFixed(2);

    console.log(
      `[Part 2 마지막 음절 분포 통계] 총 단어: ${DICTIONARY_PART2.length}, 고유 마지막 음절 수: ${lastSyllableCounts.size}, 최다 음절: '${mostFrequentSyllable}' (${maxCount}건, ${maxRatioPercentage}%)`
    );

    assert.ok(
      maxRatio <= 0.15,
      `최다 마지막 음절('${mostFrequentSyllable}') 비율이 15%를 초과합니다: ${maxRatioPercentage}% (${maxCount}/${DICTIONARY_PART2.length})`
    );
  });

  it("범주별 단어 수가 각각 균형있게 분포해야 한다 (자연·날씨, 물건, 장소·교통, 운동·놀이)", () => {
    const categoryCounts: Record<string, number> = {};
    for (const entry of DICTIONARY_PART2) {
      const cat = entry.category ?? "미분류";
      categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
    }

    assert.equal(categoryCounts["자연·날씨"], 95);
    assert.equal(categoryCounts["물건"], 95);
    assert.equal(categoryCounts["장소·교통"], 95);
    assert.equal(categoryCounts["운동·놀이"], 95);
  });

  it("난이도(difficulty 1~6)가 고르게 분포해야 한다", () => {
    const diffCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    for (const entry of DICTIONARY_PART2) {
      diffCounts[entry.difficulty] = (diffCounts[entry.difficulty] ?? 0) + 1;
    }

    assert.equal(diffCounts[1], 100);
    assert.equal(diffCounts[2], 100);
    assert.equal(diffCounts[3], 80);
    assert.equal(diffCounts[4], 60);
    assert.equal(diffCounts[5], 20);
    assert.equal(diffCounts[6], 20);
  });

  it("Part 1 단어와의 중복이 없어야 한다", () => {
    const part1Words = new Set(DICTIONARY_PART1.map((e) => e.word));
    const duplicates: string[] = [];
    for (const entry of DICTIONARY_PART2) {
      if (part1Words.has(entry.word)) {
        duplicates.push(entry.word);
      }
    }
    assert.deepEqual(duplicates, [], `Part 1과 중복되는 단어: ${duplicates.join(", ")}`);
  });
});
