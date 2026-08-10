import assert from "node:assert/strict";
import { test } from "node:test";
import { extractChosung } from "./chosungUtil";

test("완성형 한글에서 초성을 결정론적으로 추출한다", () => {
  assert.equal(extractChosung("사과"), "ㅅㄱ");
  assert.equal(extractChosung("바나나"), "ㅂㄴㄴ");
  assert.equal(extractChosung("피카츄"), "ㅍㅋㅊ");
  assert.equal(extractChosung("그림자"), "ㄱㄹㅈ");
});

test("공백과 한글이 아닌 문자는 그대로 보존한다", () => {
  assert.equal(extractChosung("사과 주스"), "ㅅㄱ ㅈㅅ");
  assert.equal(extractChosung("A1 사과!"), "A1 ㅅㄱ!");
  assert.equal(extractChosung("ㄱ사과🙂"), "ㄱㅅㄱ🙂");
});
