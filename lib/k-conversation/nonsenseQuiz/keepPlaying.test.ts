// 2026-08-20 대표님 실사용(세션 7cde49ed) — "퀴즈 내라고 했는데, 케이 멋데로 종료 시키네".
//
// 실제로 일어난 일:
//   09:27:18 아이  메아리            → 정답
//   09:27:28 케이  와, 이걸 바로 맞히네! ... 다음 문제 또 풀어볼래?
//   09:27:37 아이  이게 무슨 넌센스야?  → 화제 전환으로 분류돼 **세션이 조용히 끝났다**
//   09:27:44 아이  진행해              → 붙을 세션이 없어 케이가 즉흥으로 문제를 만들고,
//                                       가짜 게임플레이 가드가 메뉴 문구로 갈아치웠다
//
// 원칙: 아이가 그만하자고 할 때까지 퀴즈를 계속한다.

import assert from "node:assert/strict";
import test from "node:test";

import { classifyChildNonsenseUtterance } from "./answerValidator";

test("실측: 퀴즈 품질에 대한 평은 세션을 끝내지 않는다", () => {
  // 이 발화는 "무슨 ... 야?" 형태라 일반 지식 질문 신호가 붙는다.
  // 예전에는 그 신호 때문에 TOPIC_SHIFT 가 되어 세션이 닫혔다.
  assert.equal(
    classifyChildNonsenseUtterance("이게 무슨 넌센스야?", {
      hasGeneralKnowledgeQuestion: true,
    } as never),
    "NEXT_QUESTION"
  );
});

test("실측: \"진행해\" 는 다음 문제 요청이다", () => {
  assert.equal(classifyChildNonsenseUtterance("진행해"), "NEXT_QUESTION");
  assert.equal(classifyChildNonsenseUtterance("계속해"), "NEXT_QUESTION");
  assert.equal(classifyChildNonsenseUtterance("이어서"), "NEXT_QUESTION");
  assert.equal(classifyChildNonsenseUtterance("그 다음"), "NEXT_QUESTION");
});

test("퀴즈가 시시하다는 평은 계속 진행이다", () => {
  assert.equal(classifyChildNonsenseUtterance("퀴즈가 좀 시시하네"), "NEXT_QUESTION");
  assert.equal(classifyChildNonsenseUtterance("이런 거 재미없어"), "NEXT_QUESTION");
});

test("\"어려워\" 는 힌트 요청으로 남는다 — 계속 진행이 이것을 가로채지 않는다", () => {
  // 아이가 어렵다고 하면 새 문제보다 힌트가 먼저다(앞선 개선에서 정한 규칙).
  assert.equal(classifyChildNonsenseUtterance("이 문제 너무 어려워"), "REQUEST_HINT");
  assert.equal(classifyChildNonsenseUtterance("몰라"), "REQUEST_HINT");
});

test("그만하자는 뜻은 여전히 중단이다 — 계속 진행이 이것을 가리지 않는다", () => {
  assert.equal(
    classifyChildNonsenseUtterance("그만", { hasPlayStop: true } as never),
    "STOP"
  );
  assert.equal(
    classifyChildNonsenseUtterance("퀴즈 그만할래", { hasPlayStop: true } as never),
    "STOP"
  );
});

test("힌트·정답 요청이 계속 진행보다 먼저다", () => {
  assert.equal(classifyChildNonsenseUtterance("힌트 줘"), "REQUEST_HINT");
  assert.equal(classifyChildNonsenseUtterance("정답 알려줘"), "REVEAL_ANSWER");
});

test("진짜 감정·갈등은 여전히 화제 전환이다", () => {
  assert.equal(
    classifyChildNonsenseUtterance("오늘 친구랑 싸웠어", {
      hasConflict: true,
    } as never),
    "TOPIC_SHIFT"
  );
  assert.equal(
    classifyChildNonsenseUtterance("나 너무 속상해", {
      hasNegativeEmotion: true,
    } as never),
    "TOPIC_SHIFT"
  );
});

test("평범한 정답 시도는 그대로 정답 판정으로 간다", () => {
  assert.equal(classifyChildNonsenseUtterance("그림자"), "ANSWER_ATTEMPT");
  assert.equal(classifyChildNonsenseUtterance("메아리"), "ANSWER_ATTEMPT");
});
