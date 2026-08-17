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
    // PC 분기는 ViewToggle 을 렌더한다. 그 파일은 automatic JSX runtime 전제라
    // React 를 import 하지 않는데, 이 테스트 러너는 classic 변환을 써서
    // 전역 React 가 없으면 "React is not defined" 로 죽는다.
    React,
  });
});

after(() => dom.window.close());

test("모바일 키보드 높이가 있으면 DemoFrame 부모 스크롤을 막고 실측 높이를 사용한다", async () => {
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <DemoFrame mobileViewportHeight={500}>
        <div>자유대화</div>
      </DemoFrame>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  let frame = container.querySelector<HTMLElement>('[data-ui="demo-frame-mobile-viewport"]');
  assert.ok(frame);
  assert.equal(frame.style.height, "500px");
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
  assert.match(frame.className, /h-dvh/);
  assert.match(frame.className, /overflow-y-auto/);

  await act(async () => root.unmount());
});

test("DemoFrame: 실제 기기(!isPc) 경로에서는 --frame-w 변수가 정의되지 않는다", async () => {
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <DemoFrame>
        <div id="test-child">실제 기기 콘텐츠</div>
      </DemoFrame>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const mobileViewport = container.querySelector<HTMLElement>('[data-ui="demo-frame-mobile-viewport"]');
  assert.ok(mobileViewport, "실제 기기에서는 demo-frame-mobile-viewport가 렌더되어야 한다");
  const child = container.querySelector<HTMLElement>("#test-child");
  assert.ok(child);
  assert.equal(mobileViewport.style.getPropertyValue("--frame-w"), "", "--frame-w는 정의되지 않아야 한다");

  await act(async () => root.unmount());
});

test("DemoFrame: PC 환경(isPc)에서는 콘텐츠 래퍼에 --frame-w 변수를 내려준다", async () => {
  // jsdom 의 matchMedia 는 read-only 접근자라 직접 대입하면 TypeError 가 난다.
  // defineProperty 로 덮어써야 한다.
  const origMatchMedia = dom.window.matchMedia;
  const setMatchMedia = (fn: unknown) =>
    Object.defineProperty(dom.window, "matchMedia", { configurable: true, writable: true, value: fn });
  setMatchMedia((query: string) => ({
    matches: query.includes("pointer: fine"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  }));

  class MockResizeObserver {
    callback: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.callback = cb;
    }
    observe(target: Element) {
      Object.defineProperty(target, "clientWidth", { configurable: true, value: 424 });
      this.callback([{ target, contentRect: { width: 424 } as DOMRectReadOnly } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    disconnect() {}
    unobserve() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver;

  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <DemoFrame>
        <div id="test-pc-child">PC 콘텐츠</div>
      </DemoFrame>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const child = container.querySelector<HTMLElement>("#test-pc-child");
  assert.ok(child);
  const wrapper = child.parentElement;
  assert.ok(wrapper);
  assert.equal(wrapper.style.getPropertyValue("--frame-w"), "424px", "콘텐츠 래퍼에 --frame-w가 실측값으로 설정되어야 한다");

  await act(async () => root.unmount());
  setMatchMedia(origMatchMedia);
});

test("clamp CSS 변수 fallback 검증: --frame-w가 없을 때 100vw fallback 문자열 패턴 확인", () => {
  const clampSample = "clamp(145px, calc(var(--frame-w, 100vw) * 0.42), 172px)";
  assert.match(clampSample, /var\(--frame-w,\s*100vw\)/, "fallback이 100vw로 설정되어 있어야 한다");
});

test("DemoFrame: 터치 가능 기기(any-pointer: coarse)는 마우스가 연결되어도 PC로 판정되지 않는다 (!isPc)", async () => {
  const origMatchMedia = dom.window.matchMedia;
  const setMatchMedia = (fn: unknown) =>
    Object.defineProperty(dom.window, "matchMedia", { configurable: true, writable: true, value: fn });

  // iPad / Android tablet with mouse: (pointer: fine) is true, but (any-pointer: coarse) is ALSO true
  setMatchMedia((query: string) => ({
    matches: query.includes("pointer: fine") || query.includes("any-pointer: coarse"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  }));

  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <DemoFrame>
        <div id="test-touch-child">터치 태블릿 콘텐츠</div>
      </DemoFrame>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const mobileViewport = container.querySelector<HTMLElement>('[data-ui="demo-frame-mobile-viewport"]');
  assert.ok(mobileViewport, "터치 기기에서는 목업 프레임 대신 mobile-viewport가 렌더되어야 한다");

  await act(async () => root.unmount());
  setMatchMedia(origMatchMedia);
});

test("DemoFrame: 실기기 경로에서는 --frame-h 변수가 정의되지 않아 fallback(100dvh)이 활성화된다", async () => {
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <DemoFrame>
        <div id="test-height-child">높이 테스트 콘텐츠</div>
      </DemoFrame>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const mobileViewport = container.querySelector<HTMLElement>('[data-ui="demo-frame-mobile-viewport"]');
  assert.ok(mobileViewport);
  assert.equal(mobileViewport.style.getPropertyValue("--frame-h"), "", "--frame-h는 실기기에서 정의되지 않아야 한다");

  await act(async () => root.unmount());
});

test("반응형 높이 fallback 문자열 검증: --frame-h가 없을 때 100dvh fallback 패턴 확인", () => {
  const heightSample = "h-[var(--frame-h,100dvh)]";
  assert.match(heightSample, /var\(--frame-h,\s*100dvh\)/, "fallback이 100dvh로 설정되어 있어야 한다");
});

test("태블릿 폭 토큰 CSS 패턴 검증: 기본 430px 및 min-width 768px 미디어 쿼리 확인", () => {
  const smartphoneToken = "--content-max-width: var(--max-width-smartphone, 430px);";
  const tabletToken = "--content-max-width: var(--max-width-tablet, 768px);";
  assert.match(smartphoneToken, /430px/, "스마트폰 기본 폭은 430px이어야 한다");
  assert.match(tabletToken, /768px/, "태블릿 폭은 768px이어야 한다");
});

