// 016 후속 — 대표님 Dev 실사용(김서아, 2026-08-20 10:45~10:52 KST).
// "게임 종료를 안 원했는데, 멋데로 또 종료하네! 개판이네. 다 개선해"
//
// 놀이가 아이 뜻과 무관하게 끊기던 네 경로를 각각 막는다.

import assert from "node:assert/strict";
import test from "node:test";

import { isWordChainContinueRequest, isWordChainDispute } from "../wordChain/wordChainSkill";
import { classifyChildNonsenseUtterance } from "../nonsenseQuiz/answerValidator";
import { pickFabricatedRecallFallbackText } from "../memory/fabricatedRecallDetector";

test('실측: "계속" 은 낱말이 아니라 진행 지시다', () => {
  // 아이: 계속  →  케이: "계속"은 내가 아직 잘 모르는 단어야!
  assert.equal(isWordChainContinueRequest("계속"), true);
  assert.equal(isWordChainContinueRequest("진행해"), true);
  assert.equal(isWordChainContinueRequest("이어서 하자"), true);
  assert.equal(isWordChainContinueRequest("다시"), true);
});

test("진행 지시는 문장 전체가 그 말일 때만 인정한다 — 낱말을 삼키지 않는다", () => {
  // 끝말잇기 낱말로 나올 수 있는 말을 진행 지시로 오인하면 게임이 망가진다.
  assert.equal(isWordChainContinueRequest("계속기"), false);
  assert.equal(isWordChainContinueRequest("가자미"), false);
  assert.equal(isWordChainContinueRequest("다시마"), false);
  assert.equal(isWordChainContinueRequest("진행"), true); // 이건 낱말로 쓰기 어렵다
});

test("실측: 오타 힌트 요청도 힌트로 인식한다", () => {
  // 아이: 흰트줘 → 인식 실패 → 자유대화로 빠진 케이가 정답 "코끼리" 를 말해 버렸다.
  assert.equal(classifyChildNonsenseUtterance("흰트?"), "REQUEST_HINT");
  assert.equal(classifyChildNonsenseUtterance("흰트줘"), "REQUEST_HINT");
  // 아이: 모루겠어 → 인식 실패 → 넌센스 세션이 끊겼다.
  assert.equal(classifyChildNonsenseUtterance("모루겠어"), "REQUEST_HINT");
});

test("놀이 중에는 기억 대체 문구가 놀이를 끊지 않는다", () => {
  // 실측: 아이가 놀이를 지적했는데 케이가 두 턴 연속 "그건 잘 기억이 안 나는데" 로 받았다.
  const inPlay = pickFabricatedRecallFallbackText([], { hasActivePlaySession: true });
  assert.ok(
    !inPlay.includes("기억이 안 나"),
    `놀이 중에 기억 이야기로 받았다: ${inPlay}`
  );
  assert.ok(
    /계속|이어서|가자/.test(inPlay),
    `놀이를 이어가는 말이 아니다: ${inPlay}`
  );
});

test("놀이가 아닐 때는 기존 기억 대체 문구를 그대로 쓴다", () => {
  // 기억 위조를 막는 목적은 그대로 지킨다.
  const normal = pickFabricatedRecallFallbackText([]);
  assert.ok(
    normal.includes("기억이 안 나") || normal.includes("놓쳤") || normal.includes("잘 모르"),
    `기존 문구가 아니다: ${normal}`
  );
});

test("놀이 중 대체 문구도 같은 말을 반복하지 않는다", () => {
  const first = pickFabricatedRecallFallbackText([], { hasActivePlaySession: true });
  const second = pickFabricatedRecallFallbackText([first], { hasActivePlaySession: true });
  assert.notEqual(second, first);
});

test("지적·이의는 여전히 낱말로 채점하지 않는다", () => {
  assert.equal(
    isWordChainDispute("또 이러네… 이모 시작하는 이빨을 말했는데, 왜 이로 시작하는 단어여야 한다고, 아이를 화나게 만드니?"),
    true
  );
});
