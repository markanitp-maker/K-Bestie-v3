import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampDifficulty,
  selectRecentKAskedOutcomes,
  selectWordChoiceForSession,
  selectWordForSession,
} from "./gameSession";

test("현재 난이도를 학년별 경계 안으로 제한한다", () => {
  assert.equal(clampDifficulty(0, 1, 3), 1);
  assert.equal(clampDifficulty(2, 1, 3), 2);
  assert.equal(clampDifficulty(7, 1, 3), 3);
});

test("개인화 카테고리와 난이도에 맞는 미사용 단어를 고른다", () => {
  const selected = selectWordForSession({
    difficulty: 1,
    minDifficulty: 1,
    maxDifficulty: 3,
    category: "스포츠",
    recentWords: ["축구"],
    random: () => 0,
  });

  assert.equal(selected?.category, "스포츠");
  assert.equal(selected?.difficulty, 1);
  assert.notEqual(selected?.word, "축구");
});

test("개인화 카테고리 후보가 없으면 같은 난이도의 전체 단어 풀로 폴백한다", () => {
  const selected = selectWordForSession({
    difficulty: 1,
    minDifficulty: 1,
    maxDifficulty: 1,
    category: "스포츠",
    recentWords: ["축구", "수영"],
    random: () => 0,
  });

  assert.ok(selected);
  assert.equal(selected.difficulty, 1);
  assert.notEqual(selected.category, "스포츠");
});

test("같은 난이도가 고갈되면 학년 허용 난이도 범위로 폴백한다", () => {
  const selected = selectWordForSession({
    difficulty: 1,
    minDifficulty: 1,
    maxDifficulty: 2,
    recentWords: [
      "사과", "우유", "강아지", "고양이", "책", "연필", "공놀이", "퍼즐", "축구", "수영",
      "뽀로로", "피카츄", "집", "학교", "공", "우산", "해", "달",
    ],
  });

  assert.ok(selected);
  assert.equal(selected.difficulty, 2);
});

test("허용 범위의 미사용 단어가 모두 고갈되면 recentWords를 비우고 재선택한다", () => {
  const selected = selectWordChoiceForSession({
    difficulty: 1,
    minDifficulty: 1,
    maxDifficulty: 1,
    recentWords: [
      "사과", "우유", "강아지", "고양이", "책", "연필", "공놀이", "퍼즐", "축구", "수영",
      "뽀로로", "피카츄", "집", "학교", "공", "우산", "해", "달",
    ],
    random: () => 0,
  });

  assert.equal(selected?.word.word, "사과");
  assert.equal(selected?.resetRecentWords, true);
});

test("child_asked를 제외한 뒤 최근 K 출제 결과 5건을 유지한다", () => {
  const selected = selectRecentKAskedOutcomes([
    { result: "child_asked", hintUsed: 0 },
    { result: "correct", hintUsed: 0 },
    { result: "child_asked", hintUsed: 0 },
    { result: "revealed", hintUsed: 1 },
    { result: "correct", hintUsed: 0 },
    { result: "skip", hintUsed: 0 },
    { result: "correct", hintUsed: 0 },
    { result: "revealed", hintUsed: 2 },
  ]);

  assert.deepEqual(selected.map((outcome) => outcome.result), [
    "correct", "revealed", "correct", "skip", "correct",
  ]);
});
