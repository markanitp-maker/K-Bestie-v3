import assert from "node:assert/strict";
import { test } from "node:test";
import { isCorrectAnswer, normalizeAnswer } from "./answerNormalize";

test("정답 정규화는 공백과 영문 대소문자를 흡수한다", () => {
  assert.equal(normalizeAnswer("  마인   크래프트  "), "마인크래프트");
  assert.equal(normalizeAnswer("  PiKa Chu  "), "pikachu");
});

test("명시된 정답과 허용 표기만 정답으로 판정한다", () => {
  assert.equal(isCorrectAnswer("  마인 크래프트 ", "마인크래프트"), true);
  assert.equal(isCorrectAnswer("PIKACHU", "pikachu"), true);
  assert.equal(isCorrectAnswer("마크", "마인크래프트", ["마크"]), true);
  assert.equal(isCorrectAnswer("포도", "사과", ["애플"]), false);
});
