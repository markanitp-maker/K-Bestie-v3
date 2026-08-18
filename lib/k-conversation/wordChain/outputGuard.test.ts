import assert from "node:assert/strict";
import { test } from "node:test";
import { detectWordChainOutputViolation } from "./outputGuard";

test("wordChain outputGuard: 필수 낱말이 포함되어 있으면 위반 아님 (false)", () => {
  assert.equal(detectWordChainOutputViolation("좋아! 나는 '차표' 할래!", "차표"), false);
  assert.equal(detectWordChainOutputViolation("케이는 차표 할게.", "차표"), false);
  assert.equal(detectWordChainOutputViolation("좋아! 나는 '사과 주스' 마실래", "사과주스"), false);
  assert.equal(detectWordChainOutputViolation("사 과!", "사과"), false);
});

test("wordChain outputGuard: 필수 낱말이 누락되어 있으면 위반 (true)", () => {
  assert.equal(
    detectWordChainOutputViolation(
      "오, 표창 짱 멋있지! 근데 그거로 시작하는 다음 단어는 뭘로 할래?",
      "장미"
    ),
    true
  );
  assert.equal(detectWordChainOutputViolation("다른 얘기 하자", "바나나"), true);
  assert.equal(detectWordChainOutputViolation("", "차표"), true);
});

test("wordChain outputGuard: requiredWord가 없거나 빈 문자열이면 위반 아님 (false)", () => {
  assert.equal(detectWordChainOutputViolation("안녕하세요", ""), false);
  assert.equal(detectWordChainOutputViolation("안녕하세요", "   "), false);
  assert.equal(detectWordChainOutputViolation("", ""), false);
});
