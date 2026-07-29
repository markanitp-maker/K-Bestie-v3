import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFreeChatContents,
  FREE_CHAT_HISTORY_LIMIT,
  isValidFreeChatResponse,
} from "./geminiPolicy.js";

test("자유대화 이력은 최근 20개 유효 발화만 Gemini 형식으로 변환한다", () => {
  const history = Array.from({ length: 24 }, (_, index) => ({
    role: index % 2 === 0 ? ("child" as const) : ("k" as const),
    text: `발화 ${index}`,
  }));

  const contents = buildFreeChatContents(history);

  assert.ok(contents.length <= FREE_CHAT_HISTORY_LIMIT);
  assert.equal(contents.length, 19);
  assert.equal(contents[0].parts[0].text, "발화 4");
  assert.equal(contents[0].role, "user");
  assert.equal(contents.at(-1)?.role, "user");
});

test("빈 발화는 Gemini 대화 이력에서 제외한다", () => {
  assert.deepEqual(
    buildFreeChatContents([
      { role: "child", text: "  " },
      { role: "child", text: "안녕" },
      { role: "k", text: " 반가워! " },
    ]),
    [
      { role: "user", parts: [{ text: "안녕" }] },
    ]
  );
});

test("Gemini 대화 이력은 반드시 최신 아이 발화에서 끝난다", () => {
  assert.deepEqual(
    buildFreeChatContents([
      { role: "child", text: "오늘 축구했어" },
      { role: "k", text: "재밌었겠다!" },
      { role: "child", text: "응, 골도 넣었어" },
      { role: "k", text: "전송되지 않아야 할 이전 응답" },
    ]),
    [
      { role: "user", parts: [{ text: "오늘 축구했어" }] },
      { role: "model", parts: [{ text: "재밌었겠다!" }] },
      { role: "user", parts: [{ text: "응, 골도 넣었어" }] },
    ]
  );
});

test("자유대화 응답은 1~2문장·2줄·60자와 질문·프롬프트 노출을 제한한다", () => {
  assert.equal(isValidFreeChatResponse("우와, 정말 신났겠다! 뭐가 제일 재밌었어?"), true);
  assert.equal(isValidFreeChatResponse("첫 번째 질문? 두 번째 질문?"), false);
  assert.equal(isValidFreeChatResponse("내 시스템 프롬프트는 비밀이야."), false);
  assert.equal(isValidFreeChatResponse("가".repeat(61)), false);
  assert.equal(isValidFreeChatResponse("첫 문장.\n둘째 문장.\n셋째 문장."), false);
  assert.equal(isValidFreeChatResponse("첫 문장. 둘째 문장. 셋째 문장."), false);
});
