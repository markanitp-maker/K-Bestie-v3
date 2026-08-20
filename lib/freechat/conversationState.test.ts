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

test("텍스트 모드는 error와 connecting을 음성 전용 플래그보다 우선한다", () => {
  assert.equal(getFreeChatConversationState({
    mode: "text",
    status: "error",
    isRecording: true,
    isResponding: false,
    isSpeaking: true,
  }), "error");

  assert.equal(getFreeChatConversationState({
    mode: "text",
    status: "connecting",
    isRecording: true,
    isResponding: true,
    isSpeaking: true,
  }), "connecting");
});

test("텍스트 모드는 listening과 speaking 플래그를 idle로 차단한다", () => {
  assert.equal(getFreeChatConversationState({
    mode: "text",
    status: "live",
    isRecording: true,
    isResponding: false,
    isSpeaking: true,
  }), "idle");
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
  // 이 단정은 원래 옛 JSX 모양(`{(mode === "text" || !isKeyboardOpen) && (`)을 찾았다.
  // 015(requests/a04.png)에서 대표님이 "상태 표시와 황금열쇠를 1줄에 같이 표시.
  // 2열로 나오니까 위에 말풍선이 다 짤리자나" 라고 해서 구조가 바뀌었다 —
  // 알약을 `voiceStatePill` 로 뽑아, 키보드가 닫히면 상태 패널에, 열리면 황금열쇠 줄에
  // 렌더한다. **뱃지가 양쪽 상태에서 모두 나온다는 요구는 그대로다.**
  // 그래서 단정을 지우지 않고 새 구조에 맞춰 다시 쓴다.
  const pageSource = readFileSync(resolve(process.cwd(), "app/chat/page.tsx"), "utf8");

  const pillStart = pageSource.indexOf("const voiceStatePill = (");
  assert.notEqual(pillStart, -1, "상태 알약 JSX 를 변수로 뽑아 둬야 한다");

  // 알약 자체가 아이콘과 문구를 담아야 한다.
  assert.match(
    pageSource.slice(pillStart, pillStart + 2000),
    /data-ui="text-mode-voice-state"[\s\S]*?\{StateIcon\}[\s\S]*?\{stateText\}/,
    "상태 알약이 아이콘과 문구를 렌더링해야 한다",
  );

  // 키보드가 열린 동안에도 알약이 렌더링돼야 한다(황금열쇠와 같은 줄).
  assert.match(
    pageSource,
    /\{isKeyboardOpen && voiceStatePill\}/,
    "키보드가 열리면 알약을 황금열쇠 줄에 렌더링해야 한다",
  );

  // 키보드가 닫힌 동안에는 상태 패널 안에서 렌더링돼야 한다.
  const panelStart = pageSource.indexOf("{!isKeyboardOpen && (");
  assert.notEqual(panelStart, -1, "키보드가 닫힐 때의 상태 패널 분기가 있어야 한다");
  const panelPill = pageSource.indexOf("{voiceStatePill}", panelStart);
  assert.notEqual(panelPill, -1, "상태 패널 안에서도 알약을 렌더링해야 한다");

  // 알약을 두 곳에서 쓰므로, 어느 한쪽이 사라지면 뱃지가 통째로 없어진다.
  const usages = pageSource.split("voiceStatePill").length - 1;
  assert.ok(usages >= 3, `알약 정의 1회 + 사용 2회가 있어야 한다(현재 ${usages})`);

  // 놀이 중 "채팅창 닫기" 는 계속 숨긴다(013 §3-6). 대신 015 가 종료 버튼을 넣었다.
  assert.match(
    pageSource,
    /const showTextModeOverlay = mode === "text" && !isPlayActive;/,
    "놀이 중에는 텍스트 모드 오버레이(채팅창 닫기)를 숨겨야 한다",
  );
});
