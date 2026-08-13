import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PwaInstallGuideModal } from "./PwaInstallGuideModal";

test("iPhone Safari 안내는 확정된 5단계와 도움말을 순서대로 보여 준다", () => {
  const html = renderToStaticMarkup(
    <PwaInstallGuideModal
      isOpen
      context={{ kind: "ios-safari", device: "iphone" }}
      onClose={() => undefined}
    />,
  );

  assert.match(html, /아이폰에 내친구 케이 설치하기/);
  const labels = ["⋯ 버튼", "공유", "더 보기", "홈 화면에 추가", "추가"];
  let previousIndex = -1;
  for (const label of labels) {
    const index = html.indexOf(label, previousIndex + 1);
    assert.ok(index > previousIndex, `${label} 단계가 순서대로 렌더링되어야 한다`);
    previousIndex = index;
  }
  assert.match(html, /‘홈 화면에 추가’가 보이지 않나요\?/);
  assert.match(html, /동작 편집/);
});

test("iPad Safari는 같은 5단계 안내를 iPad 제목으로 보여 준다", () => {
  const html = renderToStaticMarkup(
    <PwaInstallGuideModal
      isOpen
      context={{ kind: "ios-safari", device: "ipad" }}
      onClose={() => undefined}
    />,
  );

  assert.match(html, /아이패드에 내친구 케이 설치하기/);
  assert.match(html, /Safari 우측 하단/);
});

test("iOS 카카오톡 인앱 안내는 공유와 Safari 전환 2단계만 보여 준다", () => {
  const html = renderToStaticMarkup(
    <PwaInstallGuideModal
      isOpen
      context={{ kind: "in-app-browser", app: "kakao", os: "ios" }}
      onClose={() => undefined}
    />,
  );

  assert.match(html, /카카오톡에서 열려 있어요/);
  const labels = ["공유 버튼", "Safari로 열기"];
  let previousIndex = -1;
  for (const label of labels) {
    const index = html.indexOf(label, previousIndex + 1);
    assert.ok(index > previousIndex, `${label} 단계가 순서대로 렌더링되어야 한다`);
    previousIndex = index;
  }
  assert.doesNotMatch(html, /주소 복사하기/);
  assert.match(html, /Safari 우측 하단의 공유 버튼/);
  assert.match(html, /앱 설치를 계속 진행해 주세요/);
});

test("Android 카카오톡 인앱 안내는 Safari 전용 2단계를 노출하지 않는다", () => {
  const html = renderToStaticMarkup(
    <PwaInstallGuideModal
      isOpen
      context={{ kind: "in-app-browser", app: "kakao", os: "android" }}
      onClose={() => undefined}
    />,
  );

  assert.match(html, /카카오톡에서 열려 있어요/);
  assert.match(html, /Safari 또는 Chrome 같은 일반 브라우저/);
  assert.match(html, /주소 복사하기/);
  assert.doesNotMatch(html, /Safari로 열기/);
});

test("iOS 카카오톡 안내는 소형 화면 제목 여백을 유지한다", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("./PwaInstallGuideModal.tsx", import.meta.url), "utf8"),
  );

  assert.match(source, /isKakaoIOSGuide \? "pr-10"/);
});
