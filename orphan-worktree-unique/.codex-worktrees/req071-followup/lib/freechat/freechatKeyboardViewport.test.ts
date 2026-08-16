import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const pageSource = readFileSync(resolve(process.cwd(), "app/chat/page.tsx"), "utf8");
const missionPageSource = readFileSync(resolve(process.cwd(), "app/child/missions/page.tsx"), "utf8");
const missionLayoutSource = readFileSync(resolve(process.cwd(), "components/MissionConversationLayout.tsx"), "utf8");

test("자유대화는 키보드가 열린 동안 같은 Visual Viewport 높이를 DemoFrame과 내부 grid에 전달한다", () => {
  assert.match(pageSource, /<DemoFrame\s+mobileViewportHeight=\{keyboardViewportHeight\}/);
  assert.match(pageSource, /mobileViewportPageTop=\{isKeyboardOpen \? viewportPageTop : null\}/);
  assert.match(pageSource, /data-ui="freechat-conversation-viewport"/);
  assert.match(pageSource, /data-ui="freechat-conversation-grid"/);
  assert.match(pageSource, /\.\.\.keyboardViewportStyle/);
});

test("자유대화 텍스트 입력은 키보드가 열린 동안 safe-area를 중복하지 않는다", () => {
  assert.match(pageSource, /data-ui="freechat-input-area"/);
  assert.match(pageSource, /isKeyboardOpen\s*\? "0px"/);
  assert.match(pageSource, /calc\(clamp\(18px, 2\.5dvh, 24px\) \+ env\(safe-area-inset-bottom\)\)/);
});

test("Mission은 키보드 Visual Viewport의 높이와 문서 시작점을 바깥 DemoFrame까지 올린다", () => {
  assert.match(missionPageSource, /mobileViewportHeight=\{mobileViewportMetrics\?\.height\}/);
  assert.match(missionPageSource, /mobileViewportPageTop=\{mobileViewportMetrics\?\.pageTop\}/);
  assert.match(missionPageSource, /onKeyboardViewportMetricsChange=\{setMobileViewportMetrics\}/);
  assert.match(missionLayoutSource, /height: activeKeyboardViewportHeight, pageTop: viewportPageTop/);
  assert.match(missionPageSource, /:not\(\[data-keyboard-open="true"\]\)/);
  assert.match(missionLayoutSource, /isTextMode && isKeyboardOpen\s*\? "0px"/);
});
