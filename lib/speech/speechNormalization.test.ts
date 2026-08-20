import assert from "node:assert/strict";
import test from "node:test";
import { cleanTtsText, splitTtsSentences } from "./speechNormalization";

test("cleanTtsText: 이모지·bullet·markdown·HTML·중복 공백을 제거하고 의미를 보존한다", () => {
  const raw = "## 오늘 😊\n- **친구와** <strong>즐겁게</strong> 놀았어요.\n• [공원](https://example.com)에 갔어요.";
  assert.equal(cleanTtsText(raw), "오늘 친구와 즐겁게 놀았어요. 공원에 갔어요.");
  assert.equal(cleanTtsText("대한민국 🇰🇷 1️⃣ 첫 번째 이야기"), "대한민국 첫 번째 이야기");
});

test("splitTtsSentences: 긴 한국어 텍스트를 문장부호 단위로 빈 조각 없이 나눈다", () => {
  assert.deepEqual(splitTtsSentences("첫 문장입니다.두 번째인가요? 네! 마지막 문장입니다。   "), ["첫 문장입니다.", "두 번째인가요?", "네!", "마지막 문장입니다。"]);
});

test("cleanTtsText: 강조를 지워도 조사가 떨어지지 않는다", () => {
  // 2026-08-20 실측 — 강조 표시를 공백으로 바꿨더니 `서아 가`, `중요 한` 이 됐다.
  // 케이가 어색하게 끊어 읽는다. 붙여서 지워야 한다.
  assert.equal(cleanTtsText("**서아**가 축구를 했어요"), "서아가 축구를 했어요");
  assert.equal(cleanTtsText("*중요*한 이야기예요"), "중요한 이야기예요");
  assert.equal(cleanTtsText("__강조__된 말"), "강조된 말");
  assert.equal(cleanTtsText("<b>서아</b>는 웃었어요"), "서아는 웃었어요");
  // 낱말 사이의 강조는 원래 공백이 있으니 그대로다.
  assert.equal(cleanTtsText("서아가 **정말** 좋아했어요"), "서아가 정말 좋아했어요");
});

test("cleanTtsText: 문장 속 기호를 지워 뜻을 바꾸지 않는다", () => {
  // 지시서 §4 — 문장 의미 자체는 변경하지 않는다.
  // 예전에는 `*` 를 통째로 지워 `3 * 4` 가 `3 4` 가 됐다.
  assert.equal(cleanTtsText("3 * 4 는 12예요"), "3 * 4 는 12예요");
  assert.equal(cleanTtsText("가격은 5 > 3 이에요"), "가격은 5 > 3 이에요");
});

test("cleanTtsText: 블록 태그는 문장을 붙이지 않는다", () => {
  // 인라인 태그는 붙여 지우되, 블록 태그는 문장 경계라 공백이 필요하다.
  assert.equal(cleanTtsText("<p>첫째 문장</p><p>둘째 문장</p>"), "첫째 문장 둘째 문장");
  assert.equal(cleanTtsText("첫줄<br>둘째줄"), "첫줄 둘째줄");
});

test("cleanTtsText: 줄머리 제목·인용 기호는 없앤다", () => {
  assert.equal(cleanTtsText("# 제목\n> 인용문"), "제목 인용문");
});
