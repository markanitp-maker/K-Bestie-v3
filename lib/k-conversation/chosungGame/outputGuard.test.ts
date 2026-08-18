import assert from "node:assert/strict";
import { test } from "node:test";
import { detectChosungAnswerLeak } from "./outputGuard";

test("outputGuard: 정답 단어가 포함되어 있으면 true (유출 감지)", () => {
  assert.equal(detectChosungAnswerLeak("장화잖아! 정답은 딸기야", "딸기"), true);
  assert.equal(detectChosungAnswerLeak("딸기 맞지?", "딸기"), true);
  assert.equal(detectChosungAnswerLeak("비 오는 날 신발에 신는 건 장화잖아!", "장화"), true);
});

test("outputGuard: 정답 단어가 포함되어 있지 않으면 false", () => {
  assert.equal(detectChosungAnswerLeak("음, 힌트 하나 더 줄게! 초성은 'ㄸㄱ'야.", "딸기"), false);
  assert.equal(detectChosungAnswerLeak("아 진짜 웃겨, 절대 아니거든! 빨간색 과일이야.", "딸기"), false);
});

test("outputGuard: 빈 텍스트나 빈 정답 단어는 false", () => {
  assert.equal(detectChosungAnswerLeak("", "딸기"), false);
  assert.equal(detectChosungAnswerLeak("안녕", ""), false);
  assert.equal(detectChosungAnswerLeak("", ""), false);
});
