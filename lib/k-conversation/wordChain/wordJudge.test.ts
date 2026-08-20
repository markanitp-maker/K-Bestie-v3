// 2026-08-20 대표님 지시 — "아는 단어도 부족하고, LLM 연동해서 끝말잇기 진행하라니까".
//
// 사전은 1810 낱말이라 아이가 흔히 쓰는 말도 자주 없다(실측 거절: 이빨, 이사).
// 사전이 모르는 낱말만 LLM 에 물어본다. 판정이 실패하면 사전 결과를 그대로 쓴다 —
// 놀이가 멈추면 안 된다.

import assert from "node:assert/strict";
import test from "node:test";

import {
  judgeWordChainWord,
  shouldAcceptJudgedWord,
  WORD_JUDGE_TIMEOUT_MS,
} from "./wordJudge";

function fakeAi(text: string, delayMs = 0) {
  return {
    models: {
      generateContent: async () => {
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        return { text } as never;
      },
    },
  } as never;
}

function throwingAi(message: string) {
  return {
    models: {
      generateContent: async () => {
        throw new Error(message);
      },
    },
  } as never;
}

test("실측 낱말 '이빨' 을 낱말로 판정하면 받아 준다", async () => {
  const result = await judgeWordChainWord({
    ai: fakeAi('{"isRealWord":true,"childFriendly":true,"safeForChild":true}'),
    word: "이빨",
    requiredSyllable: "이",
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.verdict, {
    isRealWord: true,
    childFriendly: true,
    safeForChild: true,
  });
  assert.equal(shouldAcceptJudgedWord(result.verdict), true);
});

test("아이가 잘 안 쓰는 말이어도 낱말이면 받아 준다", async () => {
  // 사전에 없다는 이유로 거절당하는 경험이 훨씬 나쁘다.
  const result = await judgeWordChainWord({
    ai: fakeAi('{"isRealWord":true,"childFriendly":false,"safeForChild":true}'),
    word: "이사",
  });

  assert.equal(shouldAcceptJudgedWord(result.verdict), true);
});

test("지어낸 말은 받지 않는다", async () => {
  const result = await judgeWordChainWord({
    ai: fakeAi('{"isRealWord":false,"childFriendly":false,"safeForChild":true}'),
    word: "전선생",
  });

  assert.equal(shouldAcceptJudgedWord(result.verdict), false);
});

test("아이에게 부적절한 말은 낱말이어도 받지 않는다", async () => {
  const result = await judgeWordChainWord({
    ai: fakeAi('{"isRealWord":true,"childFriendly":false,"safeForChild":false}'),
    word: "(비속어)",
  });

  assert.equal(shouldAcceptJudgedWord(result.verdict), false);
});

test("safeForChild 가 빠져 있으면 안전하다고 가정하지 않는다", async () => {
  const result = await judgeWordChainWord({
    ai: fakeAi('{"isRealWord":true}'),
    word: "무엇",
  });

  assert.equal(result.verdict?.safeForChild, false);
  assert.equal(shouldAcceptJudgedWord(result.verdict), false);
});

test("형식이 깨진 응답은 판정을 버린다", async () => {
  const result = await judgeWordChainWord({
    ai: fakeAi("낱말 맞아요!"),
    word: "이빨",
  });

  assert.equal(result.verdict, null);
  assert.equal(result.error, "parse_failed");
  assert.equal(shouldAcceptJudgedWord(result.verdict), false);
});

test("호출이 실패해도 예외를 던지지 않는다", async () => {
  const result = await judgeWordChainWord({
    ai: throwingAi("boom"),
    word: "이빨",
  });

  assert.equal(result.verdict, null);
  assert.equal(result.error, "call_failed");
});

test("판정이 늦으면 끊고 사전 결과로 돌아간다", async () => {
  const result = await judgeWordChainWord({
    ai: fakeAi('{"isRealWord":true,"childFriendly":true,"safeForChild":true}', 120),
    word: "이빨",
    timeoutMs: 30,
  });

  assert.equal(result.verdict, null);
  assert.equal(result.error, "timeout");
});

test("빈 낱말은 호출하지 않는다", async () => {
  let called = false;
  const ai = {
    models: {
      generateContent: async () => {
        called = true;
        return { text: "{}" } as never;
      },
    },
  } as never;

  const result = await judgeWordChainWord({ ai, word: "   " });

  assert.equal(called, false);
  assert.equal(result.verdict, null);
});

test("제한 시간은 아이를 기다리게 하지 않을 만큼 짧다", () => {
  assert.ok(WORD_JUDGE_TIMEOUT_MS <= 2000, `너무 길다: ${WORD_JUDGE_TIMEOUT_MS}ms`);
});
