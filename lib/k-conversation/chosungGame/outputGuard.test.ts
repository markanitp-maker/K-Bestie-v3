import assert from "node:assert/strict";
import { test } from "node:test";
import { detectChosungAnswerLeak, detectChosungPuzzleMismatch } from "./outputGuard";

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

test("detectChosungPuzzleMismatch: 응답에 필수 초성이 포함되어 있으면 false (통과)", () => {
  assert.equal(detectChosungPuzzleMismatch("초성은 'ㄴㅇㅌ'야! 맞춰봐", "ㄴㅇㅌ"), false);
  assert.equal(detectChosungPuzzleMismatch("내가 낸 문제는 ㄴ ㅇ ㅌ 야!", "ㄴㅇㅌ"), false);
  assert.equal(detectChosungPuzzleMismatch("좋아, 초성게임 하자! ㄴㅇㅌ, 뭘까?", "ㄴㅇㅌ"), false);
});

test("detectChosungPuzzleMismatch 사고 재현: DB가 ㄴㅇㅌ 인데 응답이 'ㅅㅇㅍ인데 맞혀봐' 면 차단된다 (true)", () => {
  assert.equal(detectChosungPuzzleMismatch("이번 문제는 ㅅㅇㅍ인데 맞혀봐!", "ㄴㅇㅌ"), true);
  assert.equal(detectChosungPuzzleMismatch("ㅂㅂㅂ! 맛있는 음식이야", "ㄴㅇㅌ"), true);
  assert.equal(detectChosungPuzzleMismatch("ㅊㅅ야 ㅊㅅ!", "ㄴㅇㅌ"), true);
});

test("detectChosungPuzzleMismatch: 빈 텍스트나 빈 초성 처리", () => {
  assert.equal(detectChosungPuzzleMismatch("", "ㄴㅇㅌ"), true);
  assert.equal(detectChosungPuzzleMismatch("초성은 ㄴㅇㅌ야", ""), false);
  assert.equal(detectChosungPuzzleMismatch("", ""), false);
});

