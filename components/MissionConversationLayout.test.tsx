import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { MissionConversationLayout } from "./MissionConversationLayout";

const projectRequire = createRequire(import.meta.url);
const sandboxRequire = createRequire("/tmp/p0-real-repro-jsdom-runtime/package.json");
const { JSDOM } = (() => {
  try {
    return projectRequire("jsdom");
  } catch {
    return sandboxRequire("jsdom");
  }
})();

const dom = new JSDOM("<!doctype html><html lang=\"ko\"><body><div id=\"root\"></div></body></html>", {
  url: "https://local.test/child/missions",
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const visualViewport = new dom.window.EventTarget();
Object.defineProperty(visualViewport, "height", { configurable: true, value: 500 });
Object.defineProperty(dom.window, "innerHeight", { configurable: true, value: 800 });
Object.defineProperty(dom.window, "visualViewport", { configurable: true, value: visualViewport });
const matchMediaMock = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});
Object.defineProperty(dom.window, "matchMedia", { configurable: true, value: matchMediaMock });

before(() => {
  Object.assign(globalThis, {
    React,
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLImageElement: dom.window.HTMLImageElement,
    Image: dom.window.Image,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    ResizeObserver: ResizeObserverMock,
    matchMedia: matchMediaMock,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
});

after(() => dom.window.close());

test("녹음 상태가 남아 있어도 텍스트 모드에서는 K 상태 뱃지를 대기 중으로 렌더한다", async () => {
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MissionConversationLayout
        onClose={() => {}}
        progressCurrent={0}
        progressTotal={5}
        history={[]}
        activeTurn={{ id: "k-1", role: "k", text: "오늘 가장 기억에 남는 일은 뭐야?" }}
        voiceState="listening"
        isMuted={false}
        onToggleMute={() => {}}
        isAuto
        onChangeMode={() => {}}
        isRecording
        isMicDisabled
        onMicClick={() => {}}
        textInput=""
        onChangeTextInput={() => {}}
        onSendText={() => {}}
        isTextMode
        onToggleTextMode={() => {}}
        canEnterTextMode
        canSendText
      />,
    );
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const input = container.querySelector("input");
  const badge = container.querySelector('[data-ui="text-mode-voice-state"]');
  const icon = container.querySelector('[data-ui="text-mode-state-icon"]');
  const statusPanel = container.querySelector('[data-ui="conversation-status-panel"]');
  const viewport = container.querySelector<HTMLElement>('[data-ui="mission-conversation-viewport"]');
  const grid = container.querySelector<HTMLElement>('[data-ui="mission-conversation-grid"]');
  const inputArea = container.querySelector<HTMLElement>('[data-ui="mission-input-area"]');

  assert.equal(document.activeElement, input, "텍스트 입력창이 focus되어 있어야 한다");
  assert.equal(viewport?.dataset.keyboardOpen, "true");
  assert.equal(viewport?.style.height, "500px");
  assert.equal(grid?.style.height, "500px");
  assert.equal(inputArea?.dataset.keyboardOpen, "true");
  assert.ok(badge, "키보드가 열린 상태에서도 K 상태 뱃지가 있어야 한다");
  assert.equal(badge.getAttribute("data-keyboard-open"), "true");
  assert.match(badge.textContent ?? "", /대기 중/);
  assert.doesNotMatch(badge.textContent ?? "", /듣고 있어/);
  assert.match(icon?.getAttribute("class") ?? "", /h-\[clamp\(40px,10\.5vw,46px\)\]/);
  assert.equal(container.querySelector('button[aria-label="채팅창 닫기"]'), null);
  assert.match(statusPanel?.getAttribute("class") ?? "", /h-\[clamp\(68px,10dvh,84px\)\]/);

  await act(async () => root.unmount());
});

test("텍스트 모드는 speaking을 숨기고 처리·연결·오류 상태는 유지한다", async () => {
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);
  const cases = [
    { voiceState: "speaking", expected: "대기 중" },
    { voiceState: "thinking", expected: "생각 중" },
    { voiceState: "connecting", expected: "연결 중" },
    { voiceState: "reconnecting", expected: "다시 연결 중" },
    { voiceState: "error", expected: "연결 오류" },
  ] as const;

  for (const { voiceState, expected } of cases) {
    await act(async () => {
      root.render(
        <MissionConversationLayout
          onClose={() => {}}
          progressCurrent={0}
          progressTotal={5}
          history={[]}
          activeTurn={{ id: "k-1", role: "k", text: "오늘 가장 기억에 남는 일은 뭐야?" }}
          voiceState={voiceState}
          isMuted={false}
          onToggleMute={() => {}}
          isAuto
          onChangeMode={() => {}}
          isRecording={false}
          isMicDisabled
          onMicClick={() => {}}
          textInput=""
          onChangeTextInput={() => {}}
          onSendText={() => {}}
          isTextMode
          onToggleTextMode={() => {}}
          canEnterTextMode
          canSendText
        />,
      );
    });

    const badge = container.querySelector('[data-ui="text-mode-voice-state"]');
    assert.match(badge?.textContent ?? "", new RegExp(expected));
  }

  await act(async () => root.unmount());
});

test("canEnterTextMode=false이면 텍스트 진입 버튼이 disabled이고 canEnterTextMode=true이면 enabled이다", async () => {
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  // 1. canEnterTextMode = false -> disabled
  await act(async () => {
    root.render(
      <MissionConversationLayout
        onClose={() => {}}
        progressCurrent={0}
        progressTotal={5}
        history={[]}
        activeTurn={null}
        voiceState="idle"
        isMuted={false}
        onToggleMute={() => {}}
        isAuto
        onChangeMode={() => {}}
        isRecording={false}
        isMicDisabled={false}
        onMicClick={() => {}}
        textInput=""
        onChangeTextInput={() => {}}
        onSendText={() => {}}
        isTextMode={false}
        onToggleTextMode={() => {}}
        canEnterTextMode={false}
        canSendText={false}
        entryStatus="active"
      />,
    );
  });

  const textEntryBtnDisabled = container.querySelector<HTMLButtonElement>('button[aria-label="텍스트로 답하기"]');
  assert.ok(textEntryBtnDisabled, "텍스트로 답하기 버튼이 존재해야 한다");
  assert.equal(textEntryBtnDisabled.disabled, true, "canEnterTextMode가 false이면 버튼이 disabled여야 한다");

  // 2. canEnterTextMode = true -> enabled
  await act(async () => {
    root.render(
      <MissionConversationLayout
        onClose={() => {}}
        progressCurrent={0}
        progressTotal={5}
        history={[]}
        activeTurn={null}
        voiceState="idle"
        isMuted={false}
        onToggleMute={() => {}}
        isAuto
        onChangeMode={() => {}}
        isRecording={false}
        isMicDisabled={false}
        onMicClick={() => {}}
        textInput=""
        onChangeTextInput={() => {}}
        onSendText={() => {}}
        isTextMode={false}
        onToggleTextMode={() => {}}
        canEnterTextMode={true}
        canSendText={false}
        entryStatus="active"
      />,
    );
  });

  const textEntryBtnEnabled = container.querySelector<HTMLButtonElement>('button[aria-label="텍스트로 답하기"]');
  assert.ok(textEntryBtnEnabled, "텍스트로 답하기 버튼이 존재해야 한다");
  assert.equal(textEntryBtnEnabled.disabled, false, "canEnterTextMode가 true이고 active 상태면 버튼이 enabled여야 한다");

  // 3. canEnterTextMode = true이지만 isRecording = true -> disabled
  await act(async () => {
    root.render(
      <MissionConversationLayout
        onClose={() => {}}
        progressCurrent={0}
        progressTotal={5}
        history={[]}
        activeTurn={null}
        voiceState="listening"
        isMuted={false}
        onToggleMute={() => {}}
        isAuto
        onChangeMode={() => {}}
        isRecording={true}
        isMicDisabled={false}
        onMicClick={() => {}}
        textInput=""
        onChangeTextInput={() => {}}
        onSendText={() => {}}
        isTextMode={false}
        onToggleTextMode={() => {}}
        canEnterTextMode={true}
        canSendText={false}
        entryStatus="active"
      />,
    );
  });

  const textEntryBtnRecording = container.querySelector<HTMLButtonElement>('button[aria-label="텍스트로 답하기"]');
  assert.equal(textEntryBtnRecording?.disabled, true, "녹음 중에는 canEnterTextMode가 true여도 disabled여야 한다");

  // 4. canEnterTextMode = true이지만 entryStatus !== 'active' -> disabled
  await act(async () => {
    root.render(
      <MissionConversationLayout
        onClose={() => {}}
        progressCurrent={0}
        progressTotal={5}
        history={[]}
        activeTurn={null}
        voiceState="idle"
        isMuted={false}
        onToggleMute={() => {}}
        isAuto
        onChangeMode={() => {}}
        isRecording={false}
        isMicDisabled={false}
        onMicClick={() => {}}
        textInput=""
        onChangeTextInput={() => {}}
        onSendText={() => {}}
        isTextMode={false}
        onToggleTextMode={() => {}}
        canEnterTextMode={true}
        canSendText={false}
        entryStatus="starting"
      />,
    );
  });

  const textEntryBtnStarting = container.querySelector<HTMLButtonElement>('button[aria-label="텍스트로 답하기"]');
  assert.equal(textEntryBtnStarting?.disabled, true, "active 진입 전(starting)에는 disabled여야 한다");

  await act(async () => root.unmount());
});

test("canSendText와 입력 상태에 따라 composer readiness 속성과 전송 버튼 disabled가 결정된다", async () => {
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  // 1. canSendText = false & non-empty input -> data-send-ready="false", send disabled
  await act(async () => {
    root.render(
      <MissionConversationLayout
        onClose={() => {}}
        progressCurrent={0}
        progressTotal={5}
        history={[]}
        activeTurn={null}
        voiceState="idle"
        isMuted={false}
        onToggleMute={() => {}}
        isAuto
        onChangeMode={() => {}}
        isRecording={false}
        isMicDisabled={false}
        onMicClick={() => {}}
        textInput="친구와 놀았어"
        onChangeTextInput={() => {}}
        onSendText={() => {}}
        isTextMode={true}
        onToggleTextMode={() => {}}
        canEnterTextMode={true}
        canSendText={false}
        entryStatus="active"
      />,
    );
  });

  const composerNotReady = container.querySelector('[data-ui="mission-text-composer"]');
  assert.ok(composerNotReady, "composer 요소가 존재해야 한다");
  assert.equal(composerNotReady.getAttribute("data-send-ready"), "false");

  const sendBtnNotReady = container.querySelector<HTMLButtonElement>('button[aria-label="전송"]');
  assert.ok(sendBtnNotReady, "전송 버튼이 존재해야 한다");
  assert.equal(sendBtnNotReady.disabled, true, "canSendText가 false이면 non-empty 입력이어도 전송 버튼이 disabled여야 한다");

  // 2. canSendText = true & non-empty input -> data-send-ready="true", send enabled
  await act(async () => {
    root.render(
      <MissionConversationLayout
        onClose={() => {}}
        progressCurrent={0}
        progressTotal={5}
        history={[]}
        activeTurn={null}
        voiceState="idle"
        isMuted={false}
        onToggleMute={() => {}}
        isAuto
        onChangeMode={() => {}}
        isRecording={false}
        isMicDisabled={false}
        onMicClick={() => {}}
        textInput="친구와 놀았어"
        onChangeTextInput={() => {}}
        onSendText={() => {}}
        isTextMode={true}
        onToggleTextMode={() => {}}
        canEnterTextMode={true}
        canSendText={true}
        entryStatus="active"
      />,
    );
  });

  const composerReady = container.querySelector('[data-ui="mission-text-composer"]');
  assert.ok(composerReady, "composer 요소가 존재해야 한다");
  assert.equal(composerReady.getAttribute("data-send-ready"), "true");

  const sendBtnReady = container.querySelector<HTMLButtonElement>('button[aria-label="전송"]');
  assert.ok(sendBtnReady, "전송 버튼이 존재해야 한다");
  assert.equal(sendBtnReady.disabled, false, "canSendText가 true이고 non-empty 입력이면 전송 버튼이 enabled여야 한다");

  await act(async () => root.unmount());
});

test("canSendText가 true여도 빈 입력, closing, non-active 상태에서는 전송이 차단된다", async () => {
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  // 1. empty text input
  await act(async () => {
    root.render(
      <MissionConversationLayout
        onClose={() => {}}
        progressCurrent={0}
        progressTotal={5}
        history={[]}
        activeTurn={null}
        voiceState="idle"
        isMuted={false}
        onToggleMute={() => {}}
        isAuto
        onChangeMode={() => {}}
        isRecording={false}
        isMicDisabled={false}
        onMicClick={() => {}}
        textInput=""
        onChangeTextInput={() => {}}
        onSendText={() => {}}
        isTextMode={true}
        onToggleTextMode={() => {}}
        canEnterTextMode={true}
        canSendText={true}
        entryStatus="active"
      />,
    );
  });

  const sendBtnEmpty = container.querySelector<HTMLButtonElement>('button[aria-label="전송"]');
  assert.equal(sendBtnEmpty?.disabled, true, "입력이 비어 있으면 canSendText가 true여도 전송 버튼은 disabled여야 한다");

  // 2. whitespace-only text input
  await act(async () => {
    root.render(
      <MissionConversationLayout
        onClose={() => {}}
        progressCurrent={0}
        progressTotal={5}
        history={[]}
        activeTurn={null}
        voiceState="idle"
        isMuted={false}
        onToggleMute={() => {}}
        isAuto
        onChangeMode={() => {}}
        isRecording={false}
        isMicDisabled={false}
        onMicClick={() => {}}
        textInput="   "
        onChangeTextInput={() => {}}
        onSendText={() => {}}
        isTextMode={true}
        onToggleTextMode={() => {}}
        canEnterTextMode={true}
        canSendText={true}
        entryStatus="active"
      />,
    );
  });

  const sendBtnWhitespace = container.querySelector<HTMLButtonElement>('button[aria-label="전송"]');
  assert.equal(sendBtnWhitespace?.disabled, true, "공백만 있는 입력은 전송 버튼이 disabled여야 한다");

  // 3. isClosing = true
  await act(async () => {
    root.render(
      <MissionConversationLayout
        onClose={() => {}}
        isClosing={true}
        progressCurrent={0}
        progressTotal={5}
        history={[]}
        activeTurn={null}
        voiceState="idle"
        isMuted={false}
        onToggleMute={() => {}}
        isAuto
        onChangeMode={() => {}}
        isRecording={false}
        isMicDisabled={false}
        onMicClick={() => {}}
        textInput="친구와 놀았어"
        onChangeTextInput={() => {}}
        onSendText={() => {}}
        isTextMode={true}
        onToggleTextMode={() => {}}
        canEnterTextMode={true}
        canSendText={true}
        entryStatus="active"
      />,
    );
  });

  const sendBtnClosing = container.querySelector<HTMLButtonElement>('button[aria-label="전송"]');
  assert.equal(sendBtnClosing?.disabled, true, "isClosing이 true이면 전송 버튼이 disabled여야 한다");

  // 4. entryStatus !== 'active'
  await act(async () => {
    root.render(
      <MissionConversationLayout
        onClose={() => {}}
        progressCurrent={0}
        progressTotal={5}
        history={[]}
        activeTurn={null}
        voiceState="idle"
        isMuted={false}
        onToggleMute={() => {}}
        isAuto
        onChangeMode={() => {}}
        isRecording={false}
        isMicDisabled={false}
        onMicClick={() => {}}
        textInput="친구와 놀았어"
        onChangeTextInput={() => {}}
        onSendText={() => {}}
        isTextMode={true}
        onToggleTextMode={() => {}}
        canEnterTextMode={true}
        canSendText={true}
        entryStatus="starting"
      />,
    );
  });

  const sendBtnStarting = container.querySelector<HTMLButtonElement>('button[aria-label="전송"]');
  assert.equal(sendBtnStarting?.disabled, true, "entryStatus가 active가 아니면 전송 버튼이 disabled여야 한다");

  await act(async () => root.unmount());
});
