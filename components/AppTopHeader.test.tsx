import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppTopHeader } from "./AppTopHeader";

const ROOT = path.join(__dirname, "..");
const readSource = (relativePath: string) => readFileSync(path.join(ROOT, relativePath), "utf8");

test("AppTopHeader는 폭을 안 받으면 430px 기본값(토큰 fallback 포함)을 쓴다", () => {
  const html = renderToStaticMarkup(<AppTopHeader title="테스트 헤더" />);
  assert.match(
    html,
    /max-width:var\(--content-max-width,\s*var\(--max-width-smartphone,\s*430px\)\)/,
    "AppTopHeader는 폭 미지정 시 430px 스마트폰 기본 토큰 fallback을 사용해야 한다"
  );
});

test("AppTopHeader는 폭을 받으면 그 값을 쓴다", () => {
  const htmlWithToken = renderToStaticMarkup(
    <AppTopHeader title="대화" maxWidth="var(--max-width-app, 480px)" />
  );
  assert.match(
    htmlWithToken,
    /max-width:var\(--max-width-app,\s*480px\)/,
    "maxWidth prop이 주어지면 해당 CSS 변수/토큰이 적용되어야 한다"
  );

  const htmlWithPx = renderToStaticMarkup(
    <AppTopHeader title="커스텀" maxWidth="480px" />
  );
  assert.match(
    htmlWithPx,
    /max-width:480px/,
    "maxWidth prop으로 고정 px이 주어지면 해당 폭이 적용되어야 한다"
  );
});

test("자유대화 화면(app/chat/page.tsx)에서 헤더와 본문이 동일한 폭(480px 토큰)을 쓴다", () => {
  const source = readSource("app/chat/page.tsx");
  assert.match(
    source,
    /<AppTopHeader[^>]*maxWidth="var\(--max-width-app,\s*480px\)"/,
    "자유대화 헤더는 480px 앱 토큰을 전달해야 한다"
  );
  assert.match(
    source,
    /max-w-\[var\(--max-width-app,480px\)\]/,
    "자유대화 본문 그리드는 480px 앱 토큰을 사용해야 한다"
  );
});

test("미션 대화 화면(components/MissionConversationLayout.tsx)에서 헤더와 본문이 동일한 폭(480px 토큰)을 쓴다", () => {
  const source = readSource("components/MissionConversationLayout.tsx");
  assert.match(
    source,
    /<AppTopHeader[^>]*maxWidth="var\(--max-width-app,\s*480px\)"/,
    "미션 헤더는 480px 앱 토큰을 전달해야 한다"
  );
  assert.match(
    source,
    /max-w-\[var\(--max-width-app,480px\)\]/,
    "미션 본문 그리드는 480px 앱 토큰을 사용해야 한다"
  );
});
