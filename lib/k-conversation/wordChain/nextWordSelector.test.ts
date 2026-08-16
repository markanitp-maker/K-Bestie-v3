import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectKNextWord } from "./nextWordSelector";
import { lookupWord, WORD_CHAIN_DICTIONARY } from "./dictionaryIndex";
import { allowedNextInitials } from "./dueum";

describe("WordChain K Next Word Selector (nextWordSelector)", () => {
  it("시작 음절이 직전 단어의 끝 음절(두음법칙 포함)과 일치하는 단어만 선택되어야 한다", () => {
    const bag = lookupWord("가방")!; // 끝: '방'
    const next = selectKNextWord({
      previousWord: bag,
      usedWords: new Set(["가방"]),
      minDifficulty: 1,
      maxDifficulty: 6,
    });

    assert.ok(next);
    assert.ok(
      allowedNextInitials("방").includes(next.firstSyllable),
      `선택된 단어('${next.word}')의 첫 음절('${next.firstSyllable}')이 '방'과 일치하지 않습니다.`
    );
  });

  it("이미 사용된 단어(usedWords)는 선택되지 않아야 한다", () => {
    const bag = lookupWord("가방")!;
    // '방'으로 시작하는 단어들을 usedWords에 넣음
    const usedWords = new Set(["가방", "방학", "방아깨비", "방송실", "방학식"]);

    const next = selectKNextWord({
      previousWord: bag,
      usedWords,
      minDifficulty: 1,
      maxDifficulty: 6,
    });

    if (next) {
      assert.ok(!usedWords.has(next.normalizedWord));
      assert.ok(!usedWords.has(next.word));
    }
  });

  it("학년 난이도(minDifficulty ~ maxDifficulty) 범위를 준수해야 한다", () => {
    const bag = lookupWord("가방")!; // 끝: '방' -> '방학'(난이도 1), '방송실'(난이도 2), '방석'(난이도 2)
    const next = selectKNextWord({
      previousWord: bag,
      usedWords: new Set(["가방"]),
      minDifficulty: 1,
      maxDifficulty: 2,
    });

    assert.ok(next);
    assert.ok(
      next.difficulty >= 1 && next.difficulty <= 2,
      `난이도 범위(1~2)를 벗어났습니다: ${next.word} (난이도: ${next.difficulty})`
    );
  });

  it("Dead-end 회피 (§3-18): 아이가 이어갈 수 있는 후속 단어가 풍부한 단어를 우선 선택해야 한다", () => {
    const bag = lookupWord("가방")!; // 끝: '방'
    // '방'으로 시작하는 후보 단어들 중 후속 단어가 존재하는 단어 선택
    const selected = selectKNextWord({
      previousWord: bag,
      usedWords: new Set(["가방"]),
      minDifficulty: 1,
      maxDifficulty: 6,
    });

    assert.ok(selected);
    // 선택된 단어의 마지막 음절로 아이가 이어갈 수 있는 단어가 최소 1개 이상 존재해야 함
    const childInitials = allowedNextInitials(selected.lastSyllable);
    const availableFollowUps = WORD_CHAIN_DICTIONARY.filter(
      (entry) =>
        childInitials.includes(entry.firstSyllable) &&
        entry.normalizedWord !== selected.normalizedWord &&
        entry.normalizedWord !== "가방"
    );

    assert.ok(
      availableFollowUps.length > 0,
      `선택된 단어('${selected.word}')는 아이에게 막다른 단어(후속 ${availableFollowUps.length}개)입니다.`
    );
  });

  it("후보가 전혀 없으면 null을 반환해야 한다", () => {
    // 사전에 없는 가상의 막다른 끝 음절 단어 엔트리
    const dummyDeadEnd = {
      word: "외계단어믐",
      difficulty: 1,
      normalizedWord: "외계단어믐",
      firstSyllable: "외",
      lastSyllable: "믐",
    };

    const next = selectKNextWord({
      previousWord: dummyDeadEnd,
      usedWords: new Set(),
      minDifficulty: 1,
      maxDifficulty: 6,
    });

    assert.equal(next, null);
  });

  it("동일한 입력 조건에 대해 100% 결정론적으로 동일한 단어를 선택해야 한다", () => {
    const bag = lookupWord("가방")!;
    const usedWords = new Set(["가방"]);

    const res1 = selectKNextWord({
      previousWord: bag,
      usedWords,
      minDifficulty: 1,
      maxDifficulty: 3,
    });

    const res2 = selectKNextWord({
      previousWord: bag,
      usedWords,
      minDifficulty: 1,
      maxDifficulty: 3,
    });

    assert.ok(res1);
    assert.ok(res2);
    assert.equal(res1.normalizedWord, res2.normalizedWord);
  });

  it("실제 게임 턴 시뮬레이션: 664개 사전으로 막힐 때까지 진행하여 턴 수 측정", () => {
    // 1. 단일 게임 시뮬레이션 ('튤립'으로 시작)
    let currentWord = lookupWord("튤립")!;
    const usedWords = new Set<string>([currentWord.normalizedWord]);
    let turns = 1;
    const history: string[] = [currentWord.word];

    while (turns < 200) {
      const nextWord = selectKNextWord({
        previousWord: currentWord,
        usedWords,
        minDifficulty: 1,
        maxDifficulty: 6,
      });

      if (!nextWord) {
        break;
      }

      history.push(nextWord.word);
      usedWords.add(nextWord.normalizedWord);
      currentWord = nextWord;
      turns++;
    }

    console.log(
      `[끝말잇기 단일 시뮬레이션] 시작: '튤립', 턴 수: ${turns}턴, 경로: ${history.join(" -> ")}`
    );

    assert.ok(
      turns >= 10,
      `'튤립' 시작 시뮬레이션 턴 수가 10턴 미만입니다 (현재: ${turns}턴)`
    );

    // 2. 전체 사전 664개 단어 전수 시뮬레이션 통계
    let totalTurns = 0;
    let maxTurns = 0;
    let bestStartWord = "";

    for (const entry of WORD_CHAIN_DICTIONARY) {
      let simWord = entry;
      const simUsed = new Set<string>([simWord.normalizedWord]);
      let simTurns = 1;

      while (simTurns < 200) {
        const next = selectKNextWord({
          previousWord: simWord,
          usedWords: simUsed,
          minDifficulty: 1,
          maxDifficulty: 6,
        });

        if (!next) break;

        simUsed.add(next.normalizedWord);
        simWord = next;
        simTurns++;
      }

      totalTurns += simTurns;
      if (simTurns > maxTurns) {
        maxTurns = simTurns;
        bestStartWord = entry.word;
      }
    }

    const avgTurns = totalTurns / WORD_CHAIN_DICTIONARY.length;
    console.log(
      `[전체 사전 664개 전수 시뮬레이션] 평균 턴 수: ${avgTurns.toFixed(2)}턴, 최다 턴 수: ${maxTurns}턴 (시작 단어: '${bestStartWord}')`
    );

    assert.ok(
      avgTurns >= 10,
      `전체 사전 평균 턴 수가 10턴 미만입니다 (현재: ${avgTurns.toFixed(2)}턴)`
    );
  });
});
