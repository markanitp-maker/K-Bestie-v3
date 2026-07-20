// turnGuard 단위 테스트 — node:test 내장 러너(npm test).
// 버그①②③(게이지 오증가/말풍선 중복/케이 선점 발화)의 공통 원인이었던 "이전 답변 처리 중에도
// 새 녹음을 시작할 수 있었던" 상태머신 허점을 이 두 순수 함수가 명시적으로 막는지 검증한다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { canStartRecording, shouldAcceptChildTurn, type TurnPhase } from "./turnGuard.js";

// ── canStartRecording — STT/TTS(Tier1/2) ─────────────────────────────────
test("canStartRecording: STT/TTS — idle 상태면 녹음 시작 허용", () => {
  assert.equal(
    canStartRecording({ isLiveMode: false, answerInFlight: false, kaySpeaking: false, turnPhase: "awaiting_child" }),
    true
  );
});

test("canStartRecording: STT/TTS — 답변 처리 중(classifyAnswer 대기 등)이면 차단", () => {
  assert.equal(
    canStartRecording({ isLiveMode: false, answerInFlight: true, kaySpeaking: false, turnPhase: "awaiting_child" }),
    false
  );
});

test("canStartRecording: STT/TTS — 케이가 TTS 재생 중이면 차단", () => {
  assert.equal(
    canStartRecording({ isLiveMode: false, answerInFlight: false, kaySpeaking: true, turnPhase: "awaiting_child" }),
    false
  );
});

test("canStartRecording: STT/TTS — 처리 중이면서 동시에 케이도 말하는 중이어도 차단(둘 다 false여야 통과)", () => {
  assert.equal(
    canStartRecording({ isLiveMode: false, answerInFlight: true, kaySpeaking: true, turnPhase: "awaiting_child" }),
    false
  );
});

// ── canStartRecording — Live(Tier3) ──────────────────────────────────────
test("canStartRecording: Live — awaiting_child 상태에서만 허용", () => {
  assert.equal(
    canStartRecording({ isLiveMode: true, answerInFlight: false, kaySpeaking: false, turnPhase: "awaiting_child" }),
    true
  );
});

for (const phase of ["processing_answer", "speaking_k"] as TurnPhase[]) {
  test(`canStartRecording: Live — ${phase} 상태면 차단`, () => {
    assert.equal(
      canStartRecording({ isLiveMode: true, answerInFlight: false, kaySpeaking: false, turnPhase: phase }),
      false
    );
  });
}

// ── shouldAcceptChildTurn ─────────────────────────────────────────────────
test("shouldAcceptChildTurn: 미션이 active 상태가 아니면 항상 통과(기존 동작 유지)", () => {
  assert.equal(
    shouldAcceptChildTurn({ isLiveMode: false, answerInFlight: true, turnPhase: "processing_answer", missionActive: false }),
    true
  );
});

test("shouldAcceptChildTurn: STT/TTS — active 상태, 처리 중 아니면 통과", () => {
  assert.equal(
    shouldAcceptChildTurn({ isLiveMode: false, answerInFlight: false, turnPhase: "awaiting_child", missionActive: true }),
    true
  );
});

test("shouldAcceptChildTurn: STT/TTS — active 상태에서 이전 답변 처리 중이면 폐기(버그①②③ 핵심 수정)", () => {
  assert.equal(
    shouldAcceptChildTurn({ isLiveMode: false, answerInFlight: true, turnPhase: "awaiting_child", missionActive: true }),
    false
  );
});

test("shouldAcceptChildTurn: Live — awaiting_child가 아니면 폐기", () => {
  assert.equal(
    shouldAcceptChildTurn({ isLiveMode: true, answerInFlight: false, turnPhase: "processing_answer", missionActive: true }),
    false
  );
});

test("shouldAcceptChildTurn: Live — awaiting_child면 통과", () => {
  assert.equal(
    shouldAcceptChildTurn({ isLiveMode: true, answerInFlight: false, turnPhase: "awaiting_child", missionActive: true }),
    true
  );
});
