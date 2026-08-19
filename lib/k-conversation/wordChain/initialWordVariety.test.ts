// 요청서 010 §3-4 — 끝말잇기 첫 단어가 고정 반복되지 않는다.
//
// 2026-08-19 Dev 실측: 같은 대화 세션에서 끝말잇기를 다시 시작하면 항상 같은 첫 단어가
// 나왔다("바나나우유", "김치찌개"). 시드가 chatSessionId 하나뿐이라 해시값이 같았다.

import assert from "node:assert/strict";
import test from "node:test";

import { selectInitialKWord } from "./wordChainSkill";
import { BY_FIRST_SYLLABLE } from "./dictionaryIndex";
import { allowedNextInitials } from "./dueum";

test("010: 같은 시드라도 이미 쓴 첫 단어는 다시 고르지 않는다", () => {
  const first = selectInitialKWord(1, 4, "chat-session-1");
  const second = selectInitialKWord(1, 4, "chat-session-1", [first.normalizedWord]);
  assert.notEqual(second.normalizedWord, first.normalizedWord, "같은 첫 단어가 또 나왔다");

  const third = selectInitialKWord(1, 4, "chat-session-1", [
    first.normalizedWord,
    second.normalizedWord,
  ]);
  assert.ok(![first.normalizedWord, second.normalizedWord].includes(third.normalizedWord));
});

test("010: 제외 목록이 없으면 기존과 같은 결정론을 유지한다", () => {
  // 결정론은 재시도 안전성을 준다 — 같은 턴을 두 번 처리해도 같은 단어여야 한다.
  const a = selectInitialKWord(1, 4, "chat-session-2");
  const b = selectInitialKWord(1, 4, "chat-session-2");
  assert.equal(a.normalizedWord, b.normalizedWord);
});

test("010: 같은 제외 목록이면 결과도 같다(재시도 안전)", () => {
  const exclude = ["사과", "바나나"];
  const a = selectInitialKWord(1, 4, "chat-session-3", exclude);
  const b = selectInitialKWord(1, 4, "chat-session-3", exclude);
  assert.equal(a.normalizedWord, b.normalizedWord);
});

test("010: 후보가 전부 제외돼도 단어를 돌려준다(게임이 멈추지 않는다)", () => {
  // 제외 때문에 게임을 못 하는 것보다 겹치는 편이 낫다.
  const pool = new Set<string>();
  let current = selectInitialKWord(1, 4, "chat-session-4");
  for (let i = 0; i < 40; i += 1) {
    pool.add(current.normalizedWord);
    current = selectInitialKWord(1, 4, "chat-session-4", [...pool]);
    assert.ok(current.normalizedWord, "단어를 못 돌려줬다");
  }
  assert.ok(pool.size > 5, `첫 단어가 충분히 다양하지 않다: ${pool.size}종`);
});

test("010: 첫 단어는 이어갈 낱말이 있는 것으로 고른다(기존 규칙 유지)", () => {
  const entry = selectInitialKWord(1, 4, "chat-session-5");
  assert.ok(entry.normalizedWord.length >= 2, "한 글자 낱말을 첫 단어로 냈다");
});

test("010: 시작 단어는 아이가 이어갈 후보가 넉넉한 것만 고른다", () => {
  // 대표님 QA(2026-08-20 00:10): 케이가 "김치전" 을 냈고 아이의 "전기" 가 거절당했다.
  // '전' 으로 시작하는 사전 단어가 4개뿐이라 아이가 떠올린 말이 그 안에 없었다.
  // 임계값이 3이라 통과했던 것 — 후보가 몇 개뿐인 음절로 넘기면 계속 거절당한다.
  const MIN_FOLLOW_UPS = 6;
  for (let i = 0; i < 60; i += 1) {
    const entry = selectInitialKWord(1, 3, `seed-${i}`);
    const followUps = allowedNextInitials(entry.lastSyllable).reduce(
      (sum, initial) => sum + (BY_FIRST_SYLLABLE.get(initial)?.length ?? 0),
      0
    );
    assert.ok(
      followUps >= MIN_FOLLOW_UPS,
      `시작 단어 "${entry.word}" 의 이어갈 후보가 ${followUps}개뿐이다`
    );
  }
});

test("010: 이어갈 후보를 셀 때 두음법칙 대체 초성을 빠뜨리지 않는다", () => {
  // 예전에는 BY_FIRST_SYLLABLE.get(lastSyllable) 만 봐서 락→낙 같은 대체를 놓쳤다.
  // 그러면 실제보다 적게 세어 멀쩡한 시작 단어가 후보에서 빠진다.
  const initials = allowedNextInitials("락");
  assert.ok(initials.length >= 1);
  assert.ok(
    initials.some((initial) => initial !== "락"),
    "두음법칙 대체 초성이 후보에 없다"
  );
});
