// 018(requests/a06.png) — 끝말잇기 진행 턴의 말풍선을 정확히 3줄로 고정한다.
//
// 예전에는 지시문만 주고 문장은 LLM 이 만들었다. 그래서 한 덩어리로 뭉쳐 나왔다.
// 실측: "아이가 "레스토랑"으로 멋지게 이어줬어! 케이는 "낭떠러지"로 받을게.
//        이제 "지"로 시작하는 단어를 말해줘."
//
// 대표님 지시 형식:
//   레스토랑...
//   나는 낭떠러지!
//   이제 "지"로 시작하는 단어는?

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWordChainTurnText,
  buildWordChainNewRoundText,
} from "./wordChainSkill";

test("018: 시안 그대로 3줄을 만든다", () => {
  const text = buildWordChainTurnText({
    childWord: "레스토랑",
    kWord: "낭떠러지",
    nextSyllable: "지",
  });

  assert.equal(text, '레스토랑...\n나는 낭떠러지!\n이제 "지"로 시작하는 단어는?');
});

test("018: 항상 정확히 3줄이다", () => {
  const cases = [
    { childWord: "사과", kWord: "과자", nextSyllable: "자" },
    { childWord: "이빨", kWord: "빨래건조대", nextSyllable: "대" },
    { childWord: "가", kWord: "가방", nextSyllable: "방" },
  ];
  for (const c of cases) {
    const lines = buildWordChainTurnText(c).split("\n");
    assert.equal(lines.length, 3, `3줄이 아니다: ${JSON.stringify(lines)}`);
    assert.ok(lines[0].endsWith("..."), `1줄이 아이 낱말 형식이 아니다: ${lines[0]}`);
    assert.ok(lines[1].startsWith("나는 "), `2줄이 케이 낱말 형식이 아니다: ${lines[1]}`);
    assert.ok(lines[2].startsWith("이제 "), `3줄이 다음 음절 형식이 아니다: ${lines[2]}`);
  }
});

test("018: 1줄에는 아이 낱말만, 2줄에는 케이 낱말만 담는다", () => {
  const [first, second] = buildWordChainTurnText({
    childWord: "레스토랑",
    kWord: "낭떠러지",
    nextSyllable: "지",
  }).split("\n");

  assert.equal(first, "레스토랑...");
  assert.ok(!first.includes("낭떠러지"), "1줄에 케이 낱말이 섞였다");
  assert.equal(second, "나는 낭떠러지!");
  assert.ok(!second.includes("레스토랑"), "2줄에 아이 낱말이 섞였다");
});

test("018: 금지된 문구가 들어가지 않는다", () => {
  const text = buildWordChainTurnText({
    childWord: "레스토랑",
    kWord: "낭떠러지",
    nextSyllable: "지",
  });
  const banned = [
    "멋지게",
    "이어줬어",
    "받을게",
    "대단",
    "잘했",
    "힌트",
    "규칙",
    "시작하는 단어를 말해줘",
  ];
  for (const word of banned) {
    assert.ok(!text.includes(word), `금지 문구가 들어 있다: ${word}`);
  }
});

test("018: 3줄째는 케이 낱말의 마지막 음절을 쓴다", () => {
  const text = buildWordChainTurnText({
    childWord: "사과",
    kWord: "과자",
    nextSyllable: "자",
  });
  assert.ok(text.endsWith('이제 "자"로 시작하는 단어는?'), text);
});

test("018: 앞뒤 공백은 다듬는다", () => {
  const text = buildWordChainTurnText({
    childWord: "  레스토랑 ",
    kWord: " 낭떠러지  ",
    nextSyllable: " 지 ",
  });
  assert.equal(text, '레스토랑...\n나는 낭떠러지!\n이제 "지"로 시작하는 단어는?');
});

test("018: 3줄째 조사를 음절에 맞춘다", () => {
  // 실측(2026-08-20 12:5x) — 보정 전에는 `"둑"로`, `"장"로` 가 나갔다.
  const withBatchim = buildWordChainTurnText({
    childWord: "비빔밥",
    kWord: "밥도둑",
    nextSyllable: "둑",
  });
  assert.ok(withBatchim.endsWith('이제 "둑"으로 시작하는 단어는?'), withBatchim);

  // 시안의 "지" 는 그대로 `로` 다.
  const withoutBatchim = buildWordChainTurnText({
    childWord: "레스토랑",
    kWord: "낭떠러지",
    nextSyllable: "지",
  });
  assert.ok(withoutBatchim.endsWith('이제 "지"로 시작하는 단어는?'), withoutBatchim);
});

test("019: 케이가 막혀 새 판을 시작하는 턴도 3줄이고, 졌다는 것과 새 판임을 말한다", () => {
  // 2026-08-20 실측 — 예전에는 졌다는 말도 새 판이라는 말도 없이 낱말만 던졌다:
  //   "좋아! 나는 '위치' 할게. 이제 '치'로 시작하는 말 해줘!"
  // 대표님: "'내가 졌어, 다음 게임 또 할까?' 라고 멘트 치고 가라고 했자나.
  //          바로 다음 문제 이어지면, 아이들이 끝난건지 새로 하는건지 모르자나"
  const text = buildWordChainNewRoundText({ kWord: "위치", nextSyllable: "치" });
  const lines = text.split("\n");

  assert.equal(lines.length, 3, `3줄이 아니다: ${JSON.stringify(lines)}`);
  assert.ok(/졌어/.test(lines[0]), `졌다는 말이 없다: ${lines[0]}`);
  assert.ok(/새 게임/.test(lines[1]), `새 판이라는 말이 없다: ${lines[1]}`);
  assert.ok(lines[1].includes("위치"), `케이 새 낱말이 없다: ${lines[1]}`);
  assert.ok(lines[2].startsWith("이제 "), lines[2]);
  // 놀이를 끝내자는 말은 하지 않는다 — 아이가 그만할 때까지 이어간다.
  for (const banned of ["그만", "다음에", "이따가"]) {
    assert.ok(!text.includes(banned), `놀이를 끝내는 말이 있다: ${banned}`);
  }
});

test("019: 새 판 3줄째도 조사를 음절에 맞춘다", () => {
  const withBatchim = buildWordChainNewRoundText({ kWord: "밥도둑", nextSyllable: "둑" });
  assert.ok(withBatchim.endsWith('이제 "둑"으로 시작하는 단어는?'), withBatchim);
  const withoutBatchim = buildWordChainNewRoundText({ kWord: "위치", nextSyllable: "치" });
  assert.ok(withoutBatchim.endsWith('이제 "치"로 시작하는 단어는?'), withoutBatchim);
});
