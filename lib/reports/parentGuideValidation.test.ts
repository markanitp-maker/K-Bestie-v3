import { test } from "node:test";
import assert from "node:assert/strict";
import { validateParentGuideOutput, validateRecommendedQuestions, validateParentConversationClue } from "./parentGuideValidation";

test("정상 케이스 — clue는 조언, questions는 2~3개 의문문", () => {
  const r = validateParentGuideOutput(
    "아이는 친구들과 스케이트를 타며 즐거움을 느꼈지만 과제 부담도 남아 있습니다.",
    ["스케이트 탈 때 뭐가 제일 재미있었어?", "오늘 과제는 언제 시작하면 편할 것 같아?", "다음에도 친구들과 같이 타고 싶어?"]
  );
  assert.equal(r.clue, "아이는 친구들과 스케이트를 타며 즐거움을 느꼈지만 과제 부담도 남아 있습니다.");
  assert.equal(r.questions.length, 3);
});

test("clue에 물음표가 섞이면 null 처리", () => {
  const r = validateParentConversationClue("오늘 왜 이렇게 늦게 왔어?", []);
  assert.equal(r, null);
});

test("questions가 2개 미만이면 전체 빈 배열", () => {
  const r = validateRecommendedQuestions(["오늘 기분 어땠어?"], null);
  assert.deepEqual(r, []);
});

test("의문문이 아닌 항목(조언문)은 제외되고, 그 결과 2개 미만이면 전체 실패", () => {
  const r = validateRecommendedQuestions(
    ["공부 걱정을 내려놓고 자유롭게 놀 수 있도록 격려해 주세요.", "오늘 기분 어땠어?"],
    null
  );
  assert.deepEqual(r, []); // 의문문 1개만 남아 최소 2개 기준 미달
});

test("4개 이상 들어와도 최대 3개까지만 채택", () => {
  const r = validateRecommendedQuestions(
    ["첫번째는 뭐였어?", "두번째는 뭐였어?", "세번째는 뭐였어?", "네번째는 뭐였어?"],
    null
  );
  assert.equal(r.length, 3);
});

test("질문끼리 거의 동일하면 중복 제거", () => {
  const r = validateRecommendedQuestions(
    ["오늘 기분이 어땠어?", "오늘 기분이 어땠어??", "다음에도 같이 놀고 싶어?"],
    null
  );
  assert.equal(r.length, 2);
});

test("추천 질문이 부모 대화 실마리와 사실상 같은 문장이면 그 질문은 제외", () => {
  const clue = "아이는 친구와 놀며 즐거웠지만 과제 부담도 있습니다.";
  const r = validateRecommendedQuestions(
    ["아이는 친구와 놀며 즐거웠지만 과제 부담도 있습니다?", "다음에도 같이 놀고 싶어?", "과제는 언제 시작할까?"],
    clue
  );
  assert.equal(r.includes("아이는 친구와 놀며 즐거웠지만 과제 부담도 있습니다?"), false);
  assert.equal(r.length, 2);
});

test("빈 문자열/공백/타입 불일치는 clue null 처리", () => {
  assert.equal(validateParentConversationClue("", []), null);
  assert.equal(validateParentConversationClue("   ", []), null);
  assert.equal(validateParentConversationClue(null, []), null);
  assert.equal(validateParentConversationClue(undefined, []), null);
});

test("validateParentGuideOutput — questions가 아예 없으면 clue만 정상 반환", () => {
  const r = validateParentGuideOutput("아이는 오늘 즐거운 하루를 보냈습니다.", []);
  assert.equal(r.clue, "아이는 오늘 즐거운 하루를 보냈습니다.");
  assert.deepEqual(r.questions, []);
});
