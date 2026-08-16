import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { PwaUpdateGateModal } from "./PwaUpdateGateModal";
import { pwaUpdateCopy } from "../lib/pwa/updateFlow";
import { isSafeRoute, evaluateVersionMismatch } from "../lib/pwa/updateGate";

const projectRequire = createRequire(import.meta.url);
const sandboxRequire = createRequire("/tmp/p0-real-repro-jsdom-runtime/package.json");
const { JSDOM } = (() => {
  try {
    return projectRequire("jsdom");
  } catch {
    return sandboxRequire("jsdom");
  }
})();

const dom = new JSDOM('<!doctype html><html lang="ko"><body><div id="root"></div></body></html>', {
  url: "http://localhost/",
});

before(() => {
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    Event: dom.window.Event,
    KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
});

after(() => dom.window.close());

test("no-update (isOpen=false)는 UI를 전혀 렌더링하지 않는다 (UI 0)", async () => {
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <PwaUpdateGateModal
        isOpen={false}
        isUpdating={false}
        onUpdate={() => {}}
      />
    );
  });

  const modal = document.querySelector("[data-testid='pwa-update-gate-modal']");
  assert.equal(modal, null);

  act(() => root.unmount());
});

test("mismatch 발생 시 중앙 full-screen blocking modal과 단일 업데이트 버튼을 렌더링한다", async () => {
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <PwaUpdateGateModal
        isOpen={true}
        isUpdating={false}
        updateState="mismatch"
        onUpdate={() => {}}
      />
    );
  });

  const overlay = document.querySelector("[data-testid='pwa-update-gate-overlay']");
  const modal = document.querySelector("[data-testid='pwa-update-gate-modal']");
  const title = document.querySelector("[data-testid='pwa-update-title']");
  const button = document.querySelector("[data-testid='pwa-update-button']");

  assert.ok(overlay, "Overlay exists");
  assert.ok(modal, "Modal exists");
  assert.equal(modal?.getAttribute("role"), "alertdialog");
  assert.equal(modal?.getAttribute("aria-modal"), "true");
  assert.equal(title?.textContent, "새로운 버전이 준비됐어요.");
  assert.equal(button?.textContent, "업데이트");

  // Verify NO '나중에' or '닫기' button exists
  const allButtons = document.querySelectorAll("button");
  assert.equal(allButtons.length, 1);

  act(() => root.unmount());
});

test("Escape 키를 눌러도 모달이 닫히지 않고 경고 문구를 표시한다 (Escape 우회 차단)", async () => {
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <PwaUpdateGateModal
        isOpen={true}
        isUpdating={false}
        onUpdate={() => {}}
      />
    );
  });

  const escapeEvent = new dom.window.KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });

  await act(async () => {
    dom.window.dispatchEvent(escapeEvent);
  });

  const modal = document.querySelector("[data-testid='pwa-update-gate-modal']");
  const warning = document.querySelector("[data-testid='pwa-update-nav-warning']");

  assert.ok(modal, "Modal remains open after Escape key");
  assert.equal(warning?.textContent, "업데이트를 진행해 주세요.");

  act(() => root.unmount());
});

test("body scroll lock: 모달이 열리면 document.body.style.overflow가 hidden이 된다", async () => {
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  const initialOverflow = document.body.style.overflow;

  await act(async () => {
    root.render(
      <PwaUpdateGateModal
        isOpen={true}
        isUpdating={false}
        onUpdate={() => {}}
      />
    );
  });

  assert.equal(document.body.style.overflow, "hidden");

  await act(async () => {
    root.render(
      <PwaUpdateGateModal
        isOpen={false}
        isUpdating={false}
        onUpdate={() => {}}
      />
    );
  });

  assert.equal(document.body.style.overflow, initialOverflow);

  act(() => root.unmount());
});

test("업데이트 클릭 시 단일 activation 콜백이 실행된다", async () => {
  let clickCount = 0;
  const handleUpdate = () => {
    clickCount++;
  };

  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <PwaUpdateGateModal
        isOpen={true}
        isUpdating={false}
        onUpdate={handleUpdate}
      />
    );
  });

  const button = document.querySelector("[data-testid='pwa-update-button']") as HTMLButtonElement;
  assert.ok(button);

  await act(async () => {
    button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });

  assert.equal(clickCount, 1);

  act(() => root.unmount());
});

test("delayed/error/offline 상태에서는 버튼 문구가 '다시 업데이트'로 바뀐다", async () => {
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <PwaUpdateGateModal
        isOpen={true}
        isUpdating={false}
        updateState="delayed"
        onUpdate={() => {}}
      />
    );
  });

  const button = document.querySelector("[data-testid='pwa-update-button']");
  assert.equal(button?.textContent, "다시 업데이트");

  act(() => root.unmount());
});

test("gate가 열린 동안 외부 링크 클릭을 차단하고 경고와 onBlockedNavigation 콜백을 1회 호출한다", async () => {
  const container = document.getElementById("root");
  assert.ok(container);

  const link = document.createElement("a");
  link.setAttribute("href", "/child/missions");
  link.textContent = "Go Mission";
  document.body.appendChild(link);

  let blockedCount = 0;
  const handleBlockedNav = () => {
    blockedCount++;
  };

  const root = createRoot(container);

  await act(async () => {
    root.render(
      <PwaUpdateGateModal
        isOpen={true}
        isUpdating={false}
        onUpdate={() => {}}
        onBlockedNavigation={handleBlockedNav}
      />
    );
  });

  const clickEvent = new dom.window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });

  await act(async () => {
    link.dispatchEvent(clickEvent);
  });

  const warning = document.querySelector("[data-testid='pwa-update-nav-warning']");
  assert.equal(warning?.textContent, "업데이트를 진행해 주세요.");
  assert.equal(blockedCount, 1, "onBlockedNavigation callback should be called 1 time");

  // Overlay backdrop general click should NOT trigger onBlockedNavigation
  const overlay = document.querySelector("[data-testid='pwa-update-gate-overlay']");
  assert.ok(overlay);

  await act(async () => {
    overlay.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });

  assert.equal(blockedCount, 1, "Overlay backdrop click must NOT trigger onBlockedNavigation");

  if (link.parentNode) link.parentNode.removeChild(link);
  act(() => root.unmount());
});

test("active/critical route (/child/missions, /child/chat)는 safe route가 아니다 (defer)", () => {
  assert.equal(isSafeRoute("/child/home"), true);
  assert.equal(isSafeRoute("/parent"), true);
  assert.equal(isSafeRoute("/child/missions/daily"), false);
  assert.equal(isSafeRoute("/child/chat"), false);
});

test("network-failure 상태는 mismatch로 오판하거나 차단하지 않는다", () => {
  const result = evaluateVersionMismatch("v1.0.0", "v1.0.0");
  assert.equal(result, "no-update");
});
