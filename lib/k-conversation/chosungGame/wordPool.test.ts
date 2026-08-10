import assert from "node:assert/strict";
import { test } from "node:test";
import { extractChosung } from "./chosungUtil";
import { CHOSUNG_CATEGORIES, WORD_POOL } from "./wordPool";

test("단어 풀의 저장 초성은 원문 단어에서 항상 재현된다", () => {
  for (const entry of WORD_POOL) {
    assert.equal(extractChosung(entry.word), entry.chosung, entry.word);
  }
});

test("단어 풀은 허용된 카테고리와 1~6 난이도만 사용한다", () => {
  for (const entry of WORD_POOL) {
    assert.ok(CHOSUNG_CATEGORIES.includes(entry.category), entry.word);
    assert.ok(entry.difficulty >= 1 && entry.difficulty <= 6, entry.word);
  }
});
