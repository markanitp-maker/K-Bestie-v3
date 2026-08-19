import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildJudgeContext,
  buildJudgePrompt,
  JUDGE_CONTEXT_AFTER_TURNS,
  JUDGE_CONTEXT_BEFORE_TURNS,
  parseJudgeResponse,
} from "./judgeContext";
import type { DailyQaMessage } from "./ruleDetectors";

function msg(id: string, role: "child" | "k", text: string, minute: number): DailyQaMessage {
  return {
    id,
    sessionId: "s1",
    childId: "c1",
    role,
    content: text,
    rawTranscript: null,
    mode: "free_chat",
    createdAt: `2026-08-19T01:${String(minute).padStart(2, "0")}:00.000Z`,
  };
}

const conversation = Array.from({ length: 12 }, (_, i) =>
  msg(`m${i}`, i % 2 === 0 ? "child" : "k", `턴${i}`, i)
);

test("019 §3-8: 전체 대화가 아니라 후보 앞뒤 최소 구간만 자른다", () => {
  const ctx = buildJudgeContext("REPEATED_QUESTION", conversation, "m6")!;
  assert.ok(ctx);
  assert.equal(ctx.turns.length, JUDGE_CONTEXT_BEFORE_TURNS + 1 + JUDGE_CONTEXT_AFTER_TURNS);
  assert.equal(ctx.turns.filter((t) => t.isCandidate).length, 1);
  assert.equal(ctx.turns.find((t) => t.isCandidate)!.text, "턴6");
});

test("019 §3-8: 대화 처음/끝에서도 범위를 넘지 않는다", () => {
  const first = buildJudgeContext("REPEATED_QUESTION", conversation, "m0")!;
  assert.equal(first.turns[0].text, "턴0");
  const last = buildJudgeContext("REPEATED_QUESTION", conversation, "m11")!;
  assert.equal(last.turns[last.turns.length - 1].text, "턴11");
});

test("019: 후보를 못 찾으면 문맥을 지어내지 않고 null 이다", () => {
  assert.equal(buildJudgeContext("REPEATED_QUESTION", conversation, "없는id"), null);
});

test("019: 입력이 시간순이 아니어도 스스로 정렬한다", () => {
  const shuffled = [...conversation].reverse();
  const ctx = buildJudgeContext("REPEATED_QUESTION", shuffled, "m6")!;
  assert.deepEqual(ctx.turns.map((t) => t.text), ["턴3", "턴4", "턴5", "턴6", "턴7", "턴8"]);
});

test("019 §3-8: 프롬프트는 애매할 때 FALSE_POSITIVE 로 기울게 지시한다", () => {
  const ctx = buildJudgeContext("REPEATED_QUESTION", conversation, "m6")!;
  const prompt = buildJudgePrompt(ctx, "이미 답한 것을 다시 물었다");
  assert.match(prompt, /애매하면 FALSE_POSITIVE/);
  assert.match(prompt, /판정 대상/);
  assert.match(prompt, /이미 답한 것을 다시 물었다/);
});

test("019 §3-8: 판정 응답 파싱 — 형식이 어긋나면 FALSE_POSITIVE 로 떨어뜨린다", () => {
  assert.equal(parseJudgeResponse('{"verdict":"CONFIRMED","reason":"같은 질문"}').verdict, "CONFIRMED");
  assert.equal(parseJudgeResponse('앞말 {"verdict":"LIKELY","reason":"애매"} 뒷말').verdict, "LIKELY");
  assert.equal(parseJudgeResponse("").verdict, "FALSE_POSITIVE");
  assert.equal(parseJudgeResponse("판정 불가").verdict, "FALSE_POSITIVE");
  assert.equal(parseJudgeResponse('{"verdict":"MAYBE"}').verdict, "FALSE_POSITIVE");
  assert.equal(parseJudgeResponse('{"verdict":').verdict, "FALSE_POSITIVE");
});
