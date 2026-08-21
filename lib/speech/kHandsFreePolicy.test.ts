import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_HANDS_FREE_STT_ERRORS,
  shouldAutoPlayKAnswer,
  shouldResumeHandsFree,
} from "./kVoiceChatPolicy";

const readyToResume = {
  mode: "hands-free" as const,
  isMounted: true,
  isLoading: false,
  isListening: false,
  isSpeaking: false,
  sttErrorCount: 0,
};

test("음성대화는 TTS 종료 뒤 안전 조건을 모두 만족할 때만 재개한다", () => {
  assert.equal(shouldResumeHandsFree(readyToResume), true);
  assert.equal(shouldResumeHandsFree({ ...readyToResume, mode: "typing" }), false);
  assert.equal(shouldResumeHandsFree({ ...readyToResume, isMounted: false }), false);
});

test("로딩 중이거나 이미 듣거나 말하는 중이면 재개하지 않는다", () => {
  assert.equal(shouldResumeHandsFree({ ...readyToResume, isLoading: true }), false);
  assert.equal(shouldResumeHandsFree({ ...readyToResume, isListening: true }), false);
  assert.equal(shouldResumeHandsFree({ ...readyToResume, isSpeaking: true }), false);
});

test("STT 오류가 한도까지 누적되면 음성대화 재개를 멈춘다", () => {
  assert.equal(shouldResumeHandsFree({ ...readyToResume, sttErrorCount: MAX_HANDS_FREE_STT_ERRORS - 1 }), true);
  assert.equal(shouldResumeHandsFree({ ...readyToResume, sttErrorCount: MAX_HANDS_FREE_STT_ERRORS }), false);
});

test("채팅 모드에서는 마이크가 자동으로 다시 열리지 않는다", () => {
  // 자동 **재개**는 음성대화 전용이다. 채팅 모드에서는 부모가 누를 때만 열린다.
  assert.equal(shouldResumeHandsFree({ ...readyToResume, mode: "typing" }), false);

  // 자동 **재생**은 다르다 — 기준이 모드가 아니라 질문 경로다.
  // 처음 이 테스트는 `shouldAutoPlayKAnswer("voice", "답변", "typing") === false` 를
  // 단정했는데, 그러면 채팅 모드에서 마이크로 물었을 때 답을 안 읽어 준다.
  // 부모는 말로 물었으니 답도 듣기를 기대한다(지시서 §9).
  assert.equal(shouldAutoPlayKAnswer("voice", "답변"), true);
  assert.equal(shouldAutoPlayKAnswer("text", "답변"), false);
});

test("자동 재생 기준은 모드가 아니라 질문 경로다", () => {
  // 한때 `mode === "hands-free"` 를 조건에 넣었더니, 채팅 모드에서 마이크 버튼으로
  // 물었을 때 답을 안 읽어 줬다. 부모는 말로 물었으니 답도 듣기를 기대한다.
  // 지시서 §9 는 "음성 질문으로 시작한 경우에만" 이지 "음성대화일 때만" 이 아니다.
  assert.equal(shouldAutoPlayKAnswer("voice", "오늘 서아는 즐거웠대요"), true);

  // 텍스트로 물으면 어느 모드에서도 읽지 않는다.
  assert.equal(shouldAutoPlayKAnswer("text", "오늘 서아는 즐거웠대요"), false);

  // 빈 답변은 여전히 막는다.
  assert.equal(shouldAutoPlayKAnswer("voice", "   "), false);
});
