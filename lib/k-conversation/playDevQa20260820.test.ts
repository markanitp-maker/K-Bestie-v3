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
