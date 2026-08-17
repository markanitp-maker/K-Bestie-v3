import { test } from "node:test";
import assert from "node:assert/strict";
import { isDiscardableTranscript } from "./transcriptFilter.js";

test("버려야 하는 전사 (빈 문자열 / 공백 / 문장부호만)", () => {
  assert.equal(isDiscardableTranscript(""), true);
  assert.equal(isDiscardableTranscript(" "), true);
  assert.equal(isDiscardableTranscript("   "), true);
  assert.equal(isDiscardableTranscript("..."), true);
  assert.equal(isDiscardableTranscript(". , ! ? ~"), true);
});

test("버려야 하는 전사 (한글 자모만 - 길이 무관)", () => {
  assert.equal(isDiscardableTranscript("ㅍ"), true);
  assert.equal(isDiscardableTranscript("ㅠㅠ"), true);
  assert.equal(isDiscardableTranscript("ㅇㅇ"), true);
  assert.equal(isDiscardableTranscript("ㄱ ㄴ"), true);
  assert.equal(isDiscardableTranscript("ㅜㅜㅜ"), true);
  assert.equal(isDiscardableTranscript("ㅅ."), true);
  assert.equal(isDiscardableTranscript("  ㅍ ! "), true);
  assert.equal(isDiscardableTranscript(" ㅡㅡ ... "), true);
  assert.equal(isDiscardableTranscript("ㅋ"), true);
  assert.equal(isDiscardableTranscript("ㅋㅋㅋ"), true);
  assert.equal(isDiscardableTranscript("ㄹ"), true);
  assert.equal(isDiscardableTranscript("ㅎ"), true);
  assert.equal(isDiscardableTranscript("ㅓ"), true);
});

test("버리면 안 되는 전사 (한 글자 완성형 대답 / 일반 한글 발화)", () => {
  assert.equal(isDiscardableTranscript("응"), false);
  assert.equal(isDiscardableTranscript("네"), false);
  assert.equal(isDiscardableTranscript("아니"), false);
  assert.equal(isDiscardableTranscript("왜"), false);
  assert.equal(isDiscardableTranscript("뭐"), false);
  assert.equal(isDiscardableTranscript("나"), false);
  assert.equal(isDiscardableTranscript("너"), false);
  assert.equal(isDiscardableTranscript("음"), false);
  assert.equal(isDiscardableTranscript("어"), false);
  assert.equal(isDiscardableTranscript("아"), false);
  assert.equal(isDiscardableTranscript("헐"), false);
  assert.equal(isDiscardableTranscript("앗"), false);
  assert.equal(isDiscardableTranscript("웅"), false);
  assert.equal(isDiscardableTranscript("넹"), false);
  assert.equal(isDiscardableTranscript("응응"), false);
  assert.equal(isDiscardableTranscript("소 노래"), false);
  assert.equal(isDiscardableTranscript("네!"), false);
  assert.equal(isDiscardableTranscript("아니?"), false);
});

test("버리면 안 되는 전사 (숫자 및 영문 혼합)", () => {
  assert.equal(isDiscardableTranscript("123"), false);
  assert.equal(isDiscardableTranscript("ok"), false);
  assert.equal(isDiscardableTranscript("ok!"), false);
  assert.equal(isDiscardableTranscript("7살"), false);
  assert.equal(isDiscardableTranscript("좋아 ㅠㅠ"), false); // 완성형 음절 포함
});
