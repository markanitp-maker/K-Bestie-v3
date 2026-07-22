import { test } from "node:test";
import assert from "node:assert/strict";
import { E_REACTION_POOL, pickNonRepeatingReaction } from "./eReactionPool";

test("E_REACTION_POOL: 정확히 4개 고정 문구만 존재", () => {
  assert.equal(E_REACTION_POOL.length, 4);
  assert.deepEqual([...E_REACTION_POOL], [
    "그랬구나!", "이야기해 줘서 고마워!", "그런 일이 있었구나!", "알겠어!",
  ]);
});

test("pickNonRepeatingReaction: 반환값은 항상 풀 안에 있음", () => {
  for (let i = 0; i < 100; i++) {
    const r = pickNonRepeatingReaction(null);
    assert.ok((E_REACTION_POOL as readonly string[]).includes(r));
  }
});

test("pickNonRepeatingReaction: lastReaction이 null이 아니면 반복 회피를 시도(높은 확률로 다름)", () => {
  let sameCount = 0;
  const trials = 200;
  for (let i = 0; i < trials; i++) {
    const last = E_REACTION_POOL[i % E_REACTION_POOL.length];
    const r = pickNonRepeatingReaction(last);
    if (r === last) sameCount++;
  }
  // 유한 재시도(5회) 후에도 이론상 같은 값이 나올 수 있으나, 200회 시도 중 대부분은 회피되어야 한다.
  assert.ok(sameCount < trials * 0.1, `same-as-last count too high: ${sameCount}/${trials}`);
});
