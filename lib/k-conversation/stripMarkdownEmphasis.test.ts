// 010 — 케이 발화에 마크다운 강조가 그대로 새어 나갔다.
//
// 2026-08-20 Dev 실측: `첫 번째 단어는 **허수아비**야.` 말풍선은 <p> 평문이라
// 아이가 별표까지 본다. TTS 도 별표를 읽는다.

import assert from "node:assert/strict";
import test from "node:test";

import { stripMarkdownEmphasis } from "./stripMarkdownEmphasis";

test("010: 실측 문장의 굵게 표시를 벗긴다", () => {
  assert.equal(
    stripMarkdownEmphasis(
      "좋아, 끝말잇기 하자! 내가 먼저 시작할게. 첫 번째 단어는 **허수아비**야."
    ),
    "좋아, 끝말잇기 하자! 내가 먼저 시작할게. 첫 번째 단어는 허수아비야."
  );
});

test("010: 굵게·기울임 여러 형태를 벗긴다", () => {
  assert.equal(stripMarkdownEmphasis("__수영__ 이야"), "수영 이야");
  assert.equal(stripMarkdownEmphasis("*사과* 부터"), "사과 부터");
  assert.equal(stripMarkdownEmphasis("정답은 **무지개** 였어!"), "정답은 무지개 였어!");
  assert.equal(
    stripMarkdownEmphasis("**초성**은 **ㅅㅇ** 이야"),
    "초성은 ㅅㅇ 이야"
  );
});

test("010: 닫지 않은 굵게 표시도 남기지 않는다", () => {
  // 모델이 여는 `**` 만 쓰고 닫지 않는 경우가 실제로 있었다.
  assert.equal(stripMarkdownEmphasis("첫 단어는 **허수아비야"), "첫 단어는 허수아비야");
  assert.equal(stripMarkdownEmphasis("정답은 **수영"), "정답은 수영");
  // 홀로 남은 별표 하나는 지우지 않는다 — "3 * 4" 같은 정상 문장을 깨뜨리기 때문이다.
  // 별표 두 개 이상만 강조 잔여로 본다.
  assert.equal(stripMarkdownEmphasis("3 * 4 는 얼마일까"), "3 * 4 는 얼마일까");
});

test("010: 줄머리 제목 표시를 없앤다", () => {
  assert.equal(stripMarkdownEmphasis("## 오늘의 문제\n뭘까?"), "오늘의 문제\n뭘까?");
});

test("010: 아이가 실제로 쓰는 기호는 건드리지 않는다", () => {
  const kept = [
    "정답은 뭘까? 맞춰봐!",
    '"전기"는 글자가 이어지지 않아!',
    "우와~ 잘했어",
    "3 * 4 는 얼마일까",
    "'니'로 시작하는 단어 말해줘.",
    "케이랑 놀자 :)",
  ];
  for (const text of kept) {
    assert.equal(stripMarkdownEmphasis(text), text, `건드리면 안 되는 문장이 바뀌었다: ${text}`);
  }
});

test("010: 밑줄이 낱말 안에 있으면 그대로 둔다", () => {
  assert.equal(stripMarkdownEmphasis("child_id 가 뭐야"), "child_id 가 뭐야");
  assert.equal(stripMarkdownEmphasis("snake_case_name"), "snake_case_name");
});

test("010: 빈 문자열과 강조 없는 문장은 그대로 돌려준다", () => {
  assert.equal(stripMarkdownEmphasis(""), "");
  assert.equal(stripMarkdownEmphasis("응, 알겠어! 그만하자."), "응, 알겠어! 그만하자.");
});

test("010: 줄바꿈이 끼인 별표 쌍은 강조로 보지 않는다", () => {
  // 목록처럼 줄마다 별표가 있는 경우 앞뒤를 엉뚱하게 붙여 지우면 문장이 깨진다.
  const text = "골라봐\n* 초성게임\n* 끝말잇기";
  assert.equal(stripMarkdownEmphasis(text), text);
});
