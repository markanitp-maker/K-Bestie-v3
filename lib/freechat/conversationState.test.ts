import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { getFreeChatConversationState } from "./conversationState";

test("텍스트 모드의 live 세션은 응답 대기 중 idle로 표시한다", () => {
  assert.equal(getFreeChatConversationState({
    mode: "text",
    status: "live",
    isRecording: false,
    isResponding: false,
    isSpeaking: false,
  }), "idle");
});

test("텍스트 응답 생성 중에는 live 세션이어도 thinking으로 표시한다", () => {
  assert.equal(getFreeChatConversationState({
    mode: "text",
    status: "live",
    isRecording: false,
    isResponding: true,
    isSpeaking: false,
  }), "thinking");
});

test("텍스트 모드는 음성 전용 상태보다 responding 여부만 반영한다", () => {
  assert.equal(getFreeChatConversationState({
    mode: "text",
    status: "error",
    isRecording: true,
    isResponding: false,
    isSpeaking: true,
  }), "idle");

  assert.equal(getFreeChatConversationState({
    mode: "text",
    status: "connecting",
    isRecording: true,
    isResponding: true,
    isSpeaking: true,
  }), "thinking");
});

test("음성 모드의 live 세션은 녹음 중이 아니어도 listening으로 표시한다", () => {
  assert.equal(getFreeChatConversationState({
    mode: "voice",
    status: "live",
    isRecording: false,
    isResponding: false,
    isSpeaking: false,
  }), "listening");
});

test("음성 모드에서 녹음 중이면 live 상태가 아니어도 listening으로 표시한다", () => {
  assert.equal(getFreeChatConversationState({
    mode: "voice",
    status: "ended",
    isRecording: true,
    isResponding: false,
    isSpeaking: false,
  }), "listening");
});

test("음성 모드에서는 responding이 recording보다 우선한다", () => {
  assert.equal(getFreeChatConversationState({
    mode: "voice",
    status: "live",
    isRecording: true,
    isResponding: true,
    isSpeaking: false,
  }), "thinking");
});

test("음성 모드에서는 speaking이 responding보다 우선한다", () => {
  assert.equal(getFreeChatConversationState({
    mode: "voice",
    status: "live",
    isRecording: false,
    isResponding: true,
    isSpeaking: true,
  }), "speaking");
});

test("error 상태는 speaking보다 우선한다", () => {
  assert.equal(getFreeChatConversationState({
    mode: "voice",
    status: "error",
    isRecording: true,
    isResponding: true,
    isSpeaking: true,
  }), "error");
});

test("connecting 상태는 speaking보다 우선한다", () => {
  assert.equal(getFreeChatConversationState({
    mode: "voice",
    status: "connecting",
    isRecording: true,
    isResponding: true,
    isSpeaking: true,
  }), "connecting");
});

test("음성 모드의 ended 세션은 모든 플래그가 꺼지면 idle로 표시한다", () => {
  assert.equal(getFreeChatConversationState({
    mode: "voice",
    status: "ended",
    isRecording: false,
    isResponding: false,
    isSpeaking: false,
  }), "idle");
});

test("텍스트 모드 JSX는 키보드가 열려도 상태 뱃지를 렌더링한다", () => {
  const pageSource = readFileSync(resolve(process.cwd(), "app/chat/page.tsx"), "utf8");
  const textBranchStart = pageSource.indexOf('{mode === "text" ? (');
  const voiceBranchStart = pageSource.indexOf('/* mode !== "text"', textBranchStart);

  assert.notEqual(textBranchStart, -1, "텍스트 모드 JSX 분기가 있어야 한다");
  assert.notEqual(voiceBranchStart, -1, "음성 모드 JSX 분기가 있어야 한다");
  assert.match(
    pageSource,
    /\{\(mode === "text" \|\| !isKeyboardOpen\) && \(/,
    "키보드가 열려도 텍스트 모드 상태 영역을 유지해야 한다",
  );
  assert.match(
    pageSource.slice(textBranchStart, voiceBranchStart),
    /data-ui="text-mode-voice-state"[\s\S]*?\{StateIcon\}[\s\S]*?\{stateText\}/,
    "텍스트 모드 분기 안에서 상태 아이콘과 문구를 렌더링해야 한다",
  );
});
