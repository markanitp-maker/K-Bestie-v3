import { test } from "node:test";
import assert from "node:assert/strict";
import { isMemoryRecallQuery } from "./memoryRecallTrigger";

test("기존 명시적 키워드 트리거는 그대로 동작한다", () => {
  assert.equal(isMemoryRecallQuery("저번에 내가 뭐라고 했지?"), true);
  assert.equal(isMemoryRecallQuery("나 로봇 좋아한다고 했지?"), true);
  assert.equal(isMemoryRecallQuery("기억나?"), true);
});

test("066-llm-wiki: 키워드 없는 자기 자신에 대한 되묻기 질문도 잡는다", () => {
  assert.equal(isMemoryRecallQuery("내가 싫어하는 과일이 뭐지?"), true);
  assert.equal(isMemoryRecallQuery("내가 먹고 싶은 과일은?"), true);
  assert.equal(isMemoryRecallQuery("내가 제일 좋아하는 게 뭐야?"), true);
});

test("기억 방법을 묻는 질문은 여전히 제외한다", () => {
  assert.equal(isMemoryRecallQuery("기억하는 법 알려줘"), false);
});

test("내가 없는 일반 지식 질문은 회상으로 취급하지 않는다", () => {
  assert.equal(isMemoryRecallQuery("지구는 왜 둥글어?"), false);
  assert.equal(isMemoryRecallQuery("공룡은 왜 멸종했어?"), false);
});

test("의문형이 아니면 트리거하지 않는다", () => {
  assert.equal(isMemoryRecallQuery("내가 좋아하는 과일은 수박이야"), false);
});

test("claude-review 지적: 절이 바뀌어 상대(케이) 취향을 묻는 문장은 오탐하지 않는다", () => {
  assert.equal(isMemoryRecallQuery("내가 어제 떡볶이 먹었는데 너는 뭐 좋아해?"), false);
  assert.equal(isMemoryRecallQuery("내가 그건 잘 모르겠고, 케이 너는 뭐 좋아해?"), false);
});

test("같은 절 안의 자기참조 질문은 여전히 잡는다(회귀 방지)", () => {
  assert.equal(isMemoryRecallQuery("내가 싫어하는 과일이 뭐지?"), true);
  assert.equal(isMemoryRecallQuery("내가 먹고 싶은 과일은?"), true);
  assert.equal(isMemoryRecallQuery("내가 제일 좋아하는 게 뭐야?"), true);
});
