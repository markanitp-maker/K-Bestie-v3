import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfirmationQuestion, classifyConfirmationAnswer } from "./parentQuestionReconfirm";

test("buildConfirmationQuestion — 아이 답변을 그대로 되짚어 묻는다", () => {
  const q = buildConfirmationQuestion("지민이랑 제일 친해");
  assert.equal(q, `내가 잘 이해했는지 확인할게. "지민이랑 제일 친해"가 맞아?`);
});

test("classifyConfirmationAnswer — 명확한 긍정 표현은 yes", () => {
  assert.equal(classifyConfirmationAnswer("응"), "yes");
  assert.equal(classifyConfirmationAnswer("응."), "yes");
  assert.equal(classifyConfirmationAnswer("네"), "yes");
  assert.equal(classifyConfirmationAnswer("맞아"), "yes");
  assert.equal(classifyConfirmationAnswer("맞아!"), "yes");
  assert.equal(classifyConfirmationAnswer("그래"), "yes");
});

test("classifyConfirmationAnswer — 명확한 부정은 no", () => {
  assert.equal(classifyConfirmationAnswer("아니"), "no");
  assert.equal(classifyConfirmationAnswer("아니야, 수아야"), "no");
  assert.equal(classifyConfirmationAnswer("틀렸어"), "no");
});

test("classifyConfirmationAnswer — 애매하거나 새로운 내용이면 보수적으로 no(재확인 유도)", () => {
  assert.equal(classifyConfirmationAnswer("음... 잘 모르겠어"), "no");
  assert.equal(classifyConfirmationAnswer("수아랑도 친해"), "no");
  assert.equal(classifyConfirmationAnswer(""), "no");
});
