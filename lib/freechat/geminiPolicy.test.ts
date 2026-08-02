import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFreeChatContents,
  FREE_CHAT_HISTORY_LIMIT,
  validateFreeChatResponse,
  normalizeFreeChatResponse
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

test("자유대화 응답은 30자와 질문/프롬프트 노출을 제한한다", () => {
  // 1. 즐거운 이야기
  assert.equal(validateFreeChatResponse("우와, 정말 신났겠다!"), true);
  // 2. 속상한 이야기
  assert.equal(validateFreeChatResponse("그랬구나. 많이 속상했겠다."), true);
  // 3. 친구 이야기
  assert.equal(validateFreeChatResponse("친구랑 재미있게 놀았구나."), true);
  // 4. 학교 이야기
  assert.equal(validateFreeChatResponse("학교에서 그런 일이 있었구나."), true);
  // 5. 가족 이야기
  assert.equal(validateFreeChatResponse("가족이랑 좋은 시간 보냈네."), true);
  // 6. 자랑
  assert.equal(validateFreeChatResponse("정말 대단하다! 멋져."), true);
  // 7. 짧은 답변
  assert.equal(validateFreeChatResponse("응, 편하게 말해도 돼."), true);
  // 8. 잘 모르겠다는 답변
  assert.equal(validateFreeChatResponse("괜찮아. 천천히 생각해도 돼."), true);
  // 9. 말하기 싫다는 답변
  assert.equal(validateFreeChatResponse("알았어. 무리하지 않아도 돼."), true);
  // 10. 긴 이야기
  assert.equal(validateFreeChatResponse("응, 네 이야기 잘 듣고 있어."), true);
  
  // 11. 질문 포함 - ? 포함 (불가)
  assert.equal(validateFreeChatResponse("정말 재밌었겠다! 뭐가 제일 좋았어?"), false);
  // 12. 질문 포함 - ？ 포함 (불가)
  assert.equal(validateFreeChatResponse("누구랑 같이 놀았어？"), false);
  // 13. 의문사 포함 (불가)
  assert.equal(validateFreeChatResponse("왜 그런 일이 있었지."), false);
  assert.equal(validateFreeChatResponse("어디서 그랬어."), false);
  assert.equal(validateFreeChatResponse("언제 그랬어."), false);
  assert.equal(validateFreeChatResponse("누구랑 그랬어."), false);
  assert.equal(validateFreeChatResponse("뭐 하고 놀았지."), false);
  // 14. 권유/질문형 종결 포함 (불가)
  assert.equal(validateFreeChatResponse("나한테 알려줄래."), false);
  assert.equal(validateFreeChatResponse("더 말해줄래."), false);
  assert.equal(validateFreeChatResponse("같이 해볼래."), false);
  assert.equal(validateFreeChatResponse("너도 하고 싶어."), false);
  assert.equal(validateFreeChatResponse("어떨까."), false);
  assert.equal(validateFreeChatResponse("재밌었니."), false);
  // 15. 30자 초과 (불가)
  assert.equal(validateFreeChatResponse("정말 재밌었겠다! 나도 너랑 같이 축구하고 싶어. 다음에도 꼭 재밌게 놀아."), false); // 40자 이상
  // 16. 줄바꿈 3줄 이상 (불가)
  assert.equal(validateFreeChatResponse("안녕.\n반가워.\n잘 지내."), false);
  // 17. 프롬프트 유출 (불가)
  assert.equal(validateFreeChatResponse("시스템 지시에 따르면 이건 안돼."), false);
  // 18. 아이가 케이에게 질문한 경우
  assert.equal(validateFreeChatResponse("나는 아이스크림 좋아해."), true);
  // 19. 의미가 불명확한 STT
  assert.equal(validateFreeChatResponse("무슨 말인지 잘 못 들었어."), true);
  // 20. 빈 응답
  assert.equal(validateFreeChatResponse(""), false);
  // 21. 문장 중간의 "니"는 질문형 종결이 아니므로 오탐하지 않음(끝 앵커 확인)
  assert.equal(validateFreeChatResponse("다행이니 마음이 놓인다."), true);
  // 22. 선택지 제시 표현 포함 (불가)
  assert.equal(validateFreeChatResponse("놀이터에 가거나 또는 집에 있어도 돼."), false);
  assert.equal(validateFreeChatResponse("그래도 되고 아니면 안 해도 돼."), false);
  // 23. 모델명/AI 도구명 노출 (불가)
  assert.equal(validateFreeChatResponse("나는 제미나이야."), false);
  assert.equal(validateFreeChatResponse("나는 Gemini 모델이야."), false);
});

test("규칙 위반 시 응답을 보정하거나 폴백을 제공한다", () => {
  // 질문이 포함된 경우 잘라서 유효한 첫 문장 사용
  assert.equal(normalizeFreeChatResponse("정말 재밌었겠다! 뭐가 제일 좋았어?"), "정말 재밌었겠다!");
  
  // 전체가 위반일 때 고정 폴백
  assert.equal(normalizeFreeChatResponse("누구랑 같이 놀았어?"), "응, 네 이야기 잘 듣고 있어.");
  
  // 30자 초과 시 잘라서 유효한 문장 사용
  assert.equal(normalizeFreeChatResponse("정말 재밌었겠다! 나도 너랑 같이 축구하고 싶어. 정말 즐거운 하루였네."), "정말 재밌었겠다!");
  
  // 유효한 응답은 그대로 반환
  assert.equal(normalizeFreeChatResponse("우와, 정말 신났겠다!"), "우와, 정말 신났겠다!");
});
