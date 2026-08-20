import assert from "node:assert/strict";
import test from "node:test";

import { classifyChildNonsenseUtterance } from "./nonsenseQuiz/answerValidator";
import { decidePlayProposal } from "./play/playProposal";
import { extractUtteranceSignals } from "./utteranceSignals";

test("Dev QA B: '정답이 뭐야?'는 넌센스 정답 공개 요청이다", () => {
  const utterance = "정답이 뭐야?";
  assert.equal(classifyChildNonsenseUtterance(utterance, extractUtteranceSignals(utterance)), "REVEAL_ANSWER");
});

test("Dev QA D: '다른거 없어?'는 종료가 아니라 진행이다", () => {
  const signals = extractUtteranceSignals("다른거 없어?");
  assert.equal(signals.hasPlayContinue, true);
  assert.equal(signals.hasPlayStop, false);
  assert.equal(extractUtteranceSignals("다른 놀이 하자").hasPlayRequestWithoutTarget, true);
});

// [철회됨] "그만 직후 UI 무발화 선택 차단" 테스트는 지웠다.
//
// 나는 "아이 발화가 없다" 를 자동 시작의 증거로 봤는데, **모달에서 놀이를 고르면
// 아이 메시지가 남지 않는다.** 발화 부재는 아무것도 증명하지 않는다.
// 로그를 다시 보면 초성 → 그만 → 끝말잇기 → 그만 → 넌센스로, 세 놀이를 차례로
// 점검한 흐름이었다. 대표님이 실제로 항의한 것은 넌센스 종료였지 자동 시작이 아니었다.
//
// 그 가드는 `executeSkillSelection`(모달 선택)을 15초간 막았다. 아이가 직접 놀이를
// 골라도 거부되니 원래 의심하던 결함보다 나쁘다. 그래서 가드와 이 테스트를 함께 되돌렸다.
// 자동 시작이 실제로 존재한다는 증거가 나오면 그때 다시 만든다.



test("Dev QA A 같은 턴 계약: '그만' 뒤 boredom이 높아도 새 놀이를 제안하지 않는다", async () => {
  const signals = extractUtteranceSignals("그만");
  const decision = await decidePlayProposal({
    db: {} as never,
    childId: "child-1",
    signals,
    boredom: "high",
    hasActivePlaySession: false,
    sessionRejected: false,
    registry: [],
  });
  assert.equal(decision.shouldPropose, false);
  assert.equal(decision.blockedReason, "explicit_play_stop");
});

// ─────────────────────────────────────────────────────────────────────────────
// 2026-08-20 20:07 QA — 대표님: "ㅇㅇ 이라고 했는데, 추가 문제 안 내고, 종료됨"
//
// 실제 원인은 `ㅇㅇ` 이 아니라 **그 앞** 이었다. DB 실측:
//   20:07:31 아이  종답은?          → 세션 종료 20:07:42
//   20:07:44 케이  정답은 '불고기'야. 그럼 넌센스 퀴즈 하나 더 내볼까?
//   20:07:48 아이  ㅇㅇ             → 이미 놀이가 없어 자유대화로 되물었다
//
// `종답은?`(정답은? 오타)이 TOPIC_SHIFT 로 분류돼 넌센스가 닫혔다.
// 직전 수정에서 `정답이 뭐야?` 만 받게 했고 `정답은?` 형태를 놓쳤다.
// ─────────────────────────────────────────────────────────────────────────────

test("Dev QA: '정답은?' 계열은 화제 전환이 아니라 정답 공개 요청이다", () => {
  for (const text of [
    "종답은?",   // 실측 오타
    "정답은?",
    "답은?",
    "정답이 뭐야?",
    "답 알려줘",
    "정답",
  ]) {
    assert.equal(
      classifyChildNonsenseUtterance(text, extractUtteranceSignals(text)),
      "REVEAL_ANSWER",
      text
    );
  }
});

test("Dev QA: 정답 공개 뒤 아이의 짧은 긍정은 다음 문제 요청이다", () => {
  // 케이가 "하나 더 내볼까?" 라고 물었을 때 아이가 답하는 말들.
  for (const text of ["ㅇㅇ", "ㅇㅋ", "응", "어", "네", "예", "그래", "좋아", "콜"]) {
    assert.equal(
      classifyChildNonsenseUtterance(text, extractUtteranceSignals(text)),
      "NEXT_QUESTION",
      text
    );
  }
});

test("Dev QA: 실제 정답이 될 수 있는 토큰은 긍정으로 삼키지 않는다", () => {
  // 시드 문항에 정답이 `해` 인 문제가 있다(태양). 긍정으로 삼키면 아이가 맞혔는데
  // 다음 문제로 넘어가 버린다. 한 글자 정답 39개 중 `어`·`네`·`예` 는 0개라 안전하다.
  for (const text of ["해", "책", "달", "꽃", "물", "꿈"]) {
    assert.equal(
      classifyChildNonsenseUtterance(text, extractUtteranceSignals(text)),
      "ANSWER_ATTEMPT",
      `정답 후보를 긍정으로 삼켰다: ${text}`
    );
  }
});
