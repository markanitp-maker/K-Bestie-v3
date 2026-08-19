import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  WORD_CHAIN_DICTIONARY,
  WORD_SET,
  ALIAS_MAP,
  BY_FIRST_SYLLABLE,
  lookupWord,
} from "./dictionaryIndex";
import { DICTIONARY_PART1 } from "./dictionary.part1";
import { DICTIONARY_PART2 } from "./dictionary.part2";
import { DICTIONARY_PART3 } from "./dictionary.part3";
import { DICTIONARY_PART4 } from "./dictionary.part4";
import { DICTIONARY_PART5 } from "./dictionary.part5";
import { DICTIONARY_PART6 } from "./dictionary.part6";
import { DICTIONARY_PART7 } from "./dictionary.part7";
import { DICTIONARY_PART8 } from "./dictionary.part8";
import { allowedNextInitials } from "./dueum";

describe("WordChain DictionaryIndex", () => {
  it("WORD_CHAIN_DICTIONARY는 part1~part8 합본이며 각 Part 개수가 유지된다", () => {
    assert.equal(DICTIONARY_PART1.length, 284);
    assert.equal(DICTIONARY_PART2.length, 380);
    assert.equal(DICTIONARY_PART3.length, 380);
    assert.equal(DICTIONARY_PART4.length, 360);
    // Part5 는 2026-08-19 실사용 로그에서 거절된 기본어 보강분이다(015).
    assert.equal(DICTIONARY_PART5.length, 36);
    // Part6 은 010 §3-2 실사용 누락어 보강분("도둑", "밥도둑" 등)이다.
    assert.equal(DICTIONARY_PART6.length, 60);
    // Part7 은 010 §3-3 "dictionary 전체 기준으로 빠진 기본어 정리" 잔여분이다.
    // 초등 일상어 80개를 표본 대조해 실제로 없던 것만 넣었다(중복 21개는 제외).
    assert.equal(DICTIONARY_PART7.length, 15);
    // Part8 은 얇은 음절 보강 및 실사용 거절어("전기", "전구", "전철", "전학" 등) 보완분이다.
    assert.equal(DICTIONARY_PART8.length, 295);
    const expected =
      DICTIONARY_PART1.length +
      DICTIONARY_PART2.length +
      DICTIONARY_PART3.length +
      DICTIONARY_PART4.length +
      DICTIONARY_PART5.length +
      DICTIONARY_PART6.length +
      DICTIONARY_PART7.length +
      DICTIONARY_PART8.length;
    assert.equal(WORD_CHAIN_DICTIONARY.length, expected);
    assert.equal(WORD_CHAIN_DICTIONARY.length, 1810);
  });

  it("015: 실사용에서 거절당한 기본어가 사전에 있다", () => {
    // 2026-08-19 김서아 Dev 로그: 아이가 "유리"를 냈는데 케이가 모르는 단어라고 거절했다.
    const words = new Set(WORD_CHAIN_DICTIONARY.map((entry) => entry.normalizedWord));
    for (const word of ["유리", "리본", "자동차", "고래", "소금", "과일", "도둑", "밥도둑"]) {
      assert.ok(words.has(word), `기본어가 사전에 없다: ${word}`);
    }
  });

  it("사전 합본에 중복된 단어가 없어야 한다", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const entry of WORD_CHAIN_DICTIONARY) {
      if (seen.has(entry.normalizedWord)) {
        duplicates.push(entry.normalizedWord);
      }
      seen.add(entry.normalizedWord);
    }
    assert.deepEqual(
      duplicates,
      [],
      `사전 합본에 중복 단어가 있습니다: ${duplicates.join(", ")}`
    );
  });

  it("WORD_SET은 모든 등록 단어를 포함해야 한다", () => {
    assert.ok(WORD_SET.size >= 1044);
    assert.ok(WORD_SET.has("가방"));
    assert.ok(WORD_SET.has("하늘"));
    assert.ok(WORD_SET.has("컴퓨터"));
    assert.ok(!WORD_SET.has("없는단어입니다"));
  });

  it("BY_FIRST_SYLLABLE은 첫 음절별로 단어를 올바르게 색인해야 한다", () => {
    const gaWords = BY_FIRST_SYLLABLE.get("가");
    assert.ok(gaWords && gaWords.length > 0);
    for (const entry of gaWords) {
      assert.equal(entry.firstSyllable, "가");
    }
  });

  it("lookupWord는 공백 정규화 후 단어를 정확히 찾아야 한다", () => {
    const found1 = lookupWord("가방");
    assert.ok(found1);
    assert.equal(found1.word, "가방");

    const foundWithSpaces = lookupWord("  가  방  ");
    assert.ok(foundWithSpaces);
    assert.equal(foundWithSpaces.word, "가방");
  });

  it("lookupWord는 등록되지 않은 단어에 대해 null을 반환해야 한다", () => {
    assert.equal(lookupWord("없는외계어단어"), null);
    assert.equal(lookupWord(""), null);
    assert.equal(lookupWord("   "), null);
  });
});

  it("010 §3-3: 사전에 이어갈 말이 없는 단어(dead-end)를 넣지 않는다", () => {
    // 리뷰 지적(2026-08-19): part7 에 "휴대폰" 을 넣었는데 끝음절 '폰' 으로 시작하는
    // 단어가 0개였다. 아이가 그 단어를 내는 순간 케이가 바로 기권한다 — 화면에는
    // 아이가 이긴 것처럼 나오지만 실제로는 게임이 끊긴 것이다.
    //
    // 사전 전체를 검사하지는 않는다. 기존 1500개에는 이미 dead-end 가 섞여 있을 수 있고
    // 그것까지 손대는 것은 이 요청서 범위가 아니다. 새로 넣는 part 만 고정한다.
    const deadEnds: string[] = [];
    for (const entry of [...DICTIONARY_PART7, ...DICTIONARY_PART8]) {
      const lastSyllable = entry.word.slice(-1);
      const hasNext = allowedNextInitials(lastSyllable).some(
        (initial) => (BY_FIRST_SYLLABLE.get(initial)?.length ?? 0) > 0
      );
      if (!hasNext) deadEnds.push(entry.word);
    }
    assert.deepEqual(deadEnds, [], `이어갈 말이 없는 단어: ${deadEnds.join(", ")}`);
  });
