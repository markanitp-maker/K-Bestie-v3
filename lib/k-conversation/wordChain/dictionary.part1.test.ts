import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DICTIONARY_PART1 } from "./dictionary.part1";
import { validateWordChainDictionary } from "./dictionaryValidator";
import { deriveWordChainEntry } from "./dictionaryTypes";

describe("WordChain Dictionary Part 1", () => {
  it("DICTIONARY_PART1은 검증기(validateWordChainDictionary)를 이슈 0건으로 통과해야 한다", () => {
    const issues = validateWordChainDictionary(DICTIONARY_PART1);
    assert.deepEqual(issues, [], `검증기 위반 항목: ${JSON.stringify(issues, null, 2)}`);
  });

  it("단어 수가 250개 이상이어야 한다 (아동 적합성 큐레이션 후 284개)", () => {
    // 아동 적합성 큐레이션으로 초등학생이 모르는 고난도/전문/성인 어휘 116개를 걷어내어 284개로 조정됨
    assert.ok(DICTIONARY_PART1.length >= 250, `단어 수가 부족합니다: ${DICTIONARY_PART1.length}`);
    assert.equal(DICTIONARY_PART1.length, 284, `현재 등록 단어 수: ${DICTIONARY_PART1.length}`);
  });

  it("모든 단어는 2음절 이상이어야 한다 (1음절 단어 제외)", () => {
    for (const entry of DICTIONARY_PART1) {
      assert.ok(
        entry.word.length >= 2,
        `2음절 미만 단어가 발견되었습니다: ${entry.word}`
      );
    }
  });

  it("모든 단어의 deriveWordChainEntry 파생값(첫음절, 끝음절, 정규화)이 일치해야 한다", () => {
    for (const entry of DICTIONARY_PART1) {
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
    for (const entry of DICTIONARY_PART1) {
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

    const maxRatio = maxCount / DICTIONARY_PART1.length;
    const maxRatioPercentage = (maxRatio * 100).toFixed(2);

    console.log(
      `[마지막 음절 분포 통계] 총 단어: ${DICTIONARY_PART1.length}, 고유 마지막 음절 수: ${lastSyllableCounts.size}, 최다 음절: '${mostFrequentSyllable}' (${maxCount}건, ${maxRatioPercentage}%)`
    );

    assert.ok(
      maxRatio <= 0.15,
      `최다 마지막 음절('${mostFrequentSyllable}') 비율이 15%를 초과합니다: ${maxRatioPercentage}% (${maxCount}/${DICTIONARY_PART1.length})`
    );
  });

  it("범주별 단어 수가 각각 균형있게 분포해야 한다 (학교생활, 음식, 동물, 식물)", () => {
    const categoryCounts: Record<string, number> = {};
    for (const entry of DICTIONARY_PART1) {
      const cat = entry.category ?? "미분류";
      categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
    }

    // 아동 적합성 큐레이션 후 범주별 단어 수 반영 (학교 74, 음식 68, 동물 81, 식물 61)
    assert.equal(categoryCounts["학교생활"], 74);
    assert.equal(categoryCounts["음식"], 68);
    assert.equal(categoryCounts["동물"], 81);
    assert.equal(categoryCounts["식물"], 61);
  });

  it("난이도(difficulty 1~6)가 고르게 분포해야 한다", () => {
    const diffCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    for (const entry of DICTIONARY_PART1) {
      diffCounts[entry.difficulty] = (diffCounts[entry.difficulty] ?? 0) + 1;
    }

    // 아동 적합성 큐레이션으로 고난도(난이도 5~6) 어휘가 대거 제외됨에 따라 난이도별 개수 반영
    assert.ok(diffCounts[1] >= 20, `난이도 1 단어 수: ${diffCounts[1]}`);
    assert.ok(diffCounts[2] >= 20, `난이도 2 단어 수: ${diffCounts[2]}`);
    assert.ok(diffCounts[3] >= 15, `난이도 3 단어 수: ${diffCounts[3]}`);
    assert.ok(diffCounts[4] >= 4, `난이도 4 단어 수: ${diffCounts[4]}`);
    assert.ok(diffCounts[5] >= 1, `난이도 5 단어 수: ${diffCounts[5]}`);
    assert.ok(diffCounts[6] >= 1, `난이도 6 단어 수: ${diffCounts[6]}`);
  });
});
