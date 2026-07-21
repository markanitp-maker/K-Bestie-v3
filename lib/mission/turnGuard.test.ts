// turnGuard 단위 테스트 — node:test 내장 러너(npm test).
// 버그①②③(게이지 오증가/말풍선 중복/케이 선점 발화)의 공통 원인이었던 "이전 답변 처리 중에도
// 새 녹음을 시작할 수 있었던" 상태머신 허점을 이 두 순수 함수가 명시적으로 막는지 검증한다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { canStartRecording, shouldAcceptChildTurn, type TurnPhase } from "./turnGuard.js";

// ── canStartRecording — STT/TTS(Tier1/2) ─────────────────────────────────
test("canStartRecording: STT/TTS — idle 상태면 녹음 시작 허용", () => {
  assert.equal(
    canStartRecording({ isLiveMode: false, answerInFlight: false, kaySpeaking: false, turnPhase: "idle" }),
    true
  );
});

test("canStartRecording: STT/TTS — 답변 처리 중(classifyAnswer 대기 등)이면 차단", () => {
  assert.equal(
    canStartRecording({ isLiveMode: false, answerInFlight: true, kaySpeaking: false, turnPhase: "idle" }),
    false
  );
});

test("canStartRecording: STT/TTS — 케이가 TTS 재생 중이면 차단", () => {
  assert.equal(
    canStartRecording({ isLiveMode: false, answerInFlight: false, kaySpeaking: true, turnPhase: "idle" }),
    false
  );
});

test("canStartRecording: STT/TTS — 처리 중이면서 동시에 케이도 말하는 중이어도 차단(둘 다 false여야 통과)", () => {
  assert.equal(
    canStartRecording({ isLiveMode: false, answerInFlight: true, kaySpeaking: true, turnPhase: "idle" }),
    false
  );
});

// ── canStartRecording — Live(Tier3) ──────────────────────────────────────
test("canStartRecording: Live — idle 상태면 허용", () => {
  assert.equal(
    canStartRecording({ isLiveMode: true, answerInFlight: false, kaySpeaking: false, turnPhase: "idle" }),
    true
  );
});

test("canStartRecording: Live — k_speaking 상태에서는 차단 (barge-in 금지)", () => {
  assert.equal(
    canStartRecording({ isLiveMode: true, answerInFlight: false, kaySpeaking: false, turnPhase: "k_speaking" }),
    false
  );
});

test("canStartRecording: Live — waiting_k 상태면 차단", () => {
  assert.equal(
    canStartRecording({ isLiveMode: true, answerInFlight: false, kaySpeaking: false, turnPhase: "waiting_k" }),
    false
  );
});

// ── shouldAcceptChildTurn ─────────────────────────────────────────────────
test("shouldAcceptChildTurn: 미션이 active 상태가 아니면 항상 통과(기존 동작 유지)", () => {
  assert.equal(
    shouldAcceptChildTurn({ isLiveMode: false, answerInFlight: true, turnPhase: "waiting_k", missionActive: false }),
    true
  );
});

test("shouldAcceptChildTurn: STT/TTS — active 상태, 처리 중 아니면 통과", () => {
  assert.equal(
    shouldAcceptChildTurn({ isLiveMode: false, answerInFlight: false, turnPhase: "idle", missionActive: true }),
    true
  );
});

test("shouldAcceptChildTurn: STT/TTS — active 상태에서 이전 답변 처리 중이면 폐기(버그①②③ 핵심 수정)", () => {
  assert.equal(
    shouldAcceptChildTurn({ isLiveMode: false, answerInFlight: true, turnPhase: "idle", missionActive: true }),
    false
  );
});

test("shouldAcceptChildTurn: Live — waiting_k 상태면 폐기", () => {
  assert.equal(
    shouldAcceptChildTurn({ isLiveMode: true, answerInFlight: false, turnPhase: "waiting_k", missionActive: true }),
    false
  );
});

test("shouldAcceptChildTurn: Live — idle이면 폐기", () => {
  assert.equal(
    shouldAcceptChildTurn({ isLiveMode: true, answerInFlight: false, turnPhase: "idle", missionActive: true }),
    false
  );
});

test("shouldAcceptChildTurn: Live — child_finalizing이면 폐기", () => {
  assert.equal(
    shouldAcceptChildTurn({ isLiveMode: true, answerInFlight: false, turnPhase: "child_finalizing", missionActive: true }),
    false
  );
});

test("shouldAcceptChildTurn: Live — k_speaking이면 폐기", () => {
  assert.equal(
    shouldAcceptChildTurn({ isLiveMode: true, answerInFlight: false, turnPhase: "k_speaking", missionActive: true }),
    false
  );
});
