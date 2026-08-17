import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationStartButton } from "./ConversationStartButton";

test("ConversationStartButton: '시작하기' 라벨과 aria-label, svg 아이콘이 렌더링된다", () => {
  const html = renderToStaticMarkup(
    <ConversationStartButton
      label="시작하기"
      aria-label="케이와 대화 시작하기"
    />
  );

  assert.ok(html.includes("시작하기"), "라벨 '시작하기'가 렌더되어야 한다");
  assert.ok(html.includes('aria-label="케이와 대화 시작하기"'), "aria-label이 올바르게 렌더되어야 한다");
  assert.ok(html.includes("<svg"), "재생 아이콘 svg가 렌더되어야 한다");
  assert.ok(html.includes("bg-[var(--color-k-orange)]"), "주황색 filled 스타일이 적용되어야 한다");
  assert.ok(!html.includes("border-t-white"), "말풍선 꼬리가 없어야 한다");
});

test("ConversationStartButton: '이어하기' 라벨과 disabled 상태가 정상 반영된다", () => {
  const html = renderToStaticMarkup(
    <ConversationStartButton
      label="이어하기"
      aria-label="진행 중인 미션 이어하기, 현재 진행률 1단계 중 5단계"
      disabled
    />
  );

  assert.ok(html.includes("이어하기"), "라벨 '이어하기'가 렌더되어야 한다");
  assert.ok(html.includes('aria-label="진행 중인 미션 이어하기, 현재 진행률 1단계 중 5단계"'), "aria-label이 올바르게 렌더되어야 한다");
  assert.ok(html.includes("disabled"), "disabled 속성이 적용되어야 한다");
});
