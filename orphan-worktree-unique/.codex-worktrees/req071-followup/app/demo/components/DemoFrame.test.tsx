import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { DemoFrame } from "./DemoFrame";

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
  url: "https://local.test/chat",
});

before(() => {
  Object.defineProperty(dom.window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    }),
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
});

after(() => dom.window.close());

test("모바일 키보드 높이가 있으면 DemoFrame 부모 스크롤을 막고 실측 높이를 사용한다", async () => {
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <DemoFrame mobileViewportHeight={500} mobileViewportPageTop={300}>
        <div>자유대화</div>
      </DemoFrame>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  let frame = container.querySelector<HTMLElement>('[data-ui="demo-frame-mobile-viewport"]');
  assert.ok(frame);
  assert.equal(frame.style.height, "500px");
  assert.equal(frame.style.position, "relative");
  assert.equal(frame.style.top, "300px");
  assert.match(frame.className, /overflow-hidden/);
  assert.doesNotMatch(frame.className, /overflow-y-auto/);

  await act(async () => {
    root.render(
      <DemoFrame mobileViewportHeight={null}>
        <div>자유대화</div>
      </DemoFrame>,
    );
  });

  frame = container.querySelector<HTMLElement>('[data-ui="demo-frame-mobile-viewport"]');
  assert.ok(frame);
  assert.equal(frame.style.height, "");
  assert.equal(frame.style.position, "");
  assert.equal(frame.style.top, "");
  assert.match(frame.className, /h-dvh/);
  assert.match(frame.className, /overflow-y-auto/);

  await act(async () => root.unmount());
});
