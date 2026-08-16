import assert from "node:assert/strict";
import { test } from "node:test";
import { extractUtteranceSignals } from "../utteranceSignals";
import {
  classifyActiveGameIntent,
  classifyOfferedResponse,
  isChosungStartRequest,
  isStandaloneChosung,
} from "./gameIntent";

test("명시적인 초성게임 요청과 아이가 낸 초성을 구분한다", () => {
  assert.equal(isChosungStartRequest("초성 게임 하자!"), true);
  assert.equal(isChosungStartRequest("초성퀴즈 문제 내줘"), true);
  assert.equal(isChosungStartRequest("오늘 학교에서 게임했어"), false);
  assert.equal(isStandaloneChosung("ㅍㅋㅊ"), true);
  assert.equal(isStandaloneChosung("ㄱ"), false);
  assert.equal(isStandaloneChosung("ㄱㄴ 정답"), false);
});

test("K의 제안에는 명시적인 긍정만 승낙으로 처리한다", () => {
  assert.equal(classifyOfferedResponse("응 좋아!"), "accept");
  assert.equal(classifyOfferedResponse("콜"), "accept");
  assert.equal(classifyOfferedResponse("지금 말고"), "decline");
  assert.equal(classifyOfferedResponse("다른 얘기 하자"), "decline");
  assert.equal(classifyOfferedResponse("오늘 학교에서 축구했어"), "decline");
});

test("진행 중 게임은 강한 비게임 신호를 가장 먼저 처리한다", () => {
  assert.equal(
    classifyActiveGameIntent("힌트 말고 나 지금 너무 속상해", extractUtteranceSignals("힌트 말고 나 지금 너무 속상해")),
    "strong_non_game",
  );
  assert.equal(
    classifyActiveGameIntent("배고파서 그만할래", extractUtteranceSignals("배고파서 그만할래")),
    "strong_non_game",
  );
});

test("포기·중단·힌트·일반 답변을 결정론적으로 분류한다", () => {
  assert.equal(classifyActiveGameIntent("모르겠다 그만, 정답 알려줘", extractUtteranceSignals("모르겠다 그만, 정답 알려줘")), "reveal");
  assert.equal(classifyActiveGameIntent("다른 얘기 하자", extractUtteranceSignals("다른 얘기 하자")), "stop");
  assert.equal(classifyActiveGameIntent("다른 거 알려줘", extractUtteranceSignals("다른 거 알려줘")), "stop");
  assert.equal(classifyActiveGameIntent("힌트 하나 줘", extractUtteranceSignals("힌트 하나 줘")), "hint");
  assert.equal(classifyActiveGameIntent("피카츄", extractUtteranceSignals("피카츄")), "answer_attempt");
});

test("게임 중 지식 질문과 기억 회상 질문은 일반 대화로 돌려보낸다", () => {
  assert.equal(classifyActiveGameIntent("공룡은 왜 멸종했어?", extractUtteranceSignals("공룡은 왜 멸종했어?")), "strong_non_game");
  assert.equal(classifyActiveGameIntent("내가 전에 말한 거 기억나?", extractUtteranceSignals("내가 전에 말한 거 기억나?")), "strong_non_game");
});
