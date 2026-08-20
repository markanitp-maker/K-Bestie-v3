// 2026-08-20 대표님 Dev QA — 초성이 욕설로 읽혀 아이가 욕을 타이핑했다.
//
//   케이: 다음은 ㅅㅂㄲㅈ야, 뭘까?     (정답 숨바꼭질)
//   아이: 시발꼬주?
//   케이: 아니야, 그런 욕 아니거든!
//
// 낱말 자체는 아무 문제가 없다 — 초성만 떼면 그렇게 읽히는 것이다.
// 그래서 낱말을 지우는 대신 초성 게임 출제 풀에서만 뺀다.

import assert from "node:assert/strict";
import test from "node:test";

import { WORD_POOL, readsAsProfanity } from "./wordPool";
import { extractChosung } from "./chosungUtil";

test("실측: 숨바꼭질(ㅅㅂㄲㅈ)은 출제되지 않는다", () => {
  assert.equal(readsAsProfanity("ㅅㅂㄲㅈ"), true);
  assert.ok(
    !WORD_POOL.some((entry) => entry.word === "숨바꼭질"),
    "숨바꼭질이 출제 풀에 남아 있다"
  );
});

test("출제 풀 전체에 욕설로 읽히는 초성이 없다", () => {
  const bad = WORD_POOL.filter((entry) => readsAsProfanity(entry.chosung)).map(
    (entry) => `${entry.word}(${entry.chosung})`
  );
  assert.deepEqual(bad, [], `욕설로 읽히는 초성이 남아 있다: ${bad.join(", ")}`);
});

test("초성은 낱말에서 실제로 뽑은 값이다", () => {
  for (const entry of WORD_POOL) {
    assert.equal(entry.chosung, extractChosung(entry.word), entry.word);
  }
});

test("평범한 초성은 걸러지지 않는다", () => {
  for (const chosung of ["ㅁㄹㅇ", "ㅋㄲㄹ", "ㄱㅂ", "ㄷㅅㄱ", "ㄴㅁ", "ㄸㄱ"]) {
    assert.equal(readsAsProfanity(chosung), false, chosung);
  }
});

test("풀이 비지 않는다 — 걸러도 낼 문제가 남아야 한다", () => {
  assert.ok(WORD_POOL.length >= 60, `출제 풀이 너무 줄었다: ${WORD_POOL.length}`);
});

test("빈 값과 공백은 안전하게 처리한다", () => {
  assert.equal(readsAsProfanity(""), false);
  assert.equal(readsAsProfanity("ㅅ ㅂ"), true, "공백을 끼워 우회할 수 없어야 한다");
});
