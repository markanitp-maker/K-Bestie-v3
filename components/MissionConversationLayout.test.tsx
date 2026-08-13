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

before(() => {
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    ResizeObserver: ResizeObserverMock,
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

  assert.equal(document.activeElement, input, "텍스트 입력창이 focus되어 있어야 한다");
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
        />,
      );
    });

    const badge = container.querySelector('[data-ui="text-mode-voice-state"]');
    assert.match(badge?.textContent ?? "", new RegExp(expected));
  }

  await act(async () => root.unmount());
});
