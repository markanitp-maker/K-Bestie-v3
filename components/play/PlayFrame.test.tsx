import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppTopHeader } from "../AppTopHeader";
import { isPlayCloseMessage, PLAY_RETURN_PATH } from "./PlayFrame";

const ROOT = path.join(__dirname, "..", "..");
const readSource = (relativePath: string) => readFileSync(path.join(ROOT, relativePath), "utf8");

function messageEvent(origin: string, data: unknown): MessageEvent {
  return { origin, data } as MessageEvent;
}

test("놀이 헤더는 `← 뒤로`가 아니라 `X 닫기`를 노출한다", () => {
  const html = renderToStaticMarkup(
    <AppTopHeader title="MBTI" onBack={() => {}} backVariant="close" />,
  );
  assert.match(html, /닫기/);
  assert.match(html, /aria-label="닫기"/);
  assert.doesNotMatch(html, /뒤로/);
});

test("backVariant 기본값은 기존 `← 뒤로` 동작을 그대로 유지한다", () => {
  const html = renderToStaticMarkup(<AppTopHeader title="미션" backHref="/child/home" />);
  assert.match(html, /← 뒤로/);
  assert.doesNotMatch(html, /aria-label="닫기"/);
});

test("동일 Origin의 지정된 놀이 종료 메시지만 수락한다", () => {
  const origin = "https://app.k-bestie.com";
  assert.equal(
    isPlayCloseMessage(messageEvent(origin, { source: "k-play-mbti", type: "PLAY_CLOSE_REQUEST" }), origin, "k-play-mbti"),
    true,
  );
  assert.equal(
    isPlayCloseMessage(messageEvent(origin, { source: "k-play-mbti", type: "PLAY_AUTO_CLOSE" }), origin, "k-play-mbti"),
    true,
  );
  // 다른 Origin / 다른 놀이 / 다른 타입 / 비객체는 전부 무시한다.
  assert.equal(
    isPlayCloseMessage(messageEvent("https://evil.example", { source: "k-play-mbti", type: "PLAY_AUTO_CLOSE" }), origin, "k-play-mbti"),
    false,
  );
  assert.equal(
    isPlayCloseMessage(messageEvent(origin, { source: "k-play-quiz", type: "PLAY_AUTO_CLOSE" }), origin, "k-play-mbti"),
    false,
  );
  assert.equal(
    isPlayCloseMessage(messageEvent(origin, { source: "k-play-mbti", type: "PLAY_SCORE" }), origin, "k-play-mbti"),
    false,
  );
  assert.equal(isPlayCloseMessage(messageEvent(origin, null), origin, "k-play-mbti"), false);
  assert.equal(isPlayCloseMessage(messageEvent(origin, "PLAY_AUTO_CLOSE"), origin, "k-play-mbti"), false);
});

test("닫기는 history 이동 계열을 쓰지 않고 replace로 /child/play 상태만 복원한다", () => {
  const source = readSource("components/play/PlayFrame.tsx");
  assert.equal(PLAY_RETURN_PATH, "/child/play");
  assert.match(source, /router\.replace\(PLAY_RETURN_PATH\)/);
  for (const forbidden of ["router.back()", "history.back()", "window.history.back()", "router.push("]) {
    assert.equal(source.includes(forbidden), false, `${forbidden}를 닫기 동작에 쓰면 안 된다`);
  }
});

test("MBTI·퀴즈마스터는 공통 PlayFrame만 쓰고 자체 닫기 로직을 두지 않는다", () => {
  for (const page of ["app/child/play/mbti/page.tsx", "app/child/play/quizmaster/page.tsx"]) {
    const source = readSource(page);
    assert.match(source, /PlayFrame/, `${page}는 공통 PlayFrame을 사용해야 한다`);
    assert.equal(source.includes("<iframe"), false, `${page}에 별도 iframe이 남아 있으면 안 된다`);
    assert.equal(source.includes("AppTopHeader"), false, `${page}가 헤더를 직접 렌더하면 종료 정책이 갈린다`);
    assert.equal(source.includes("backHref"), false, `${page}에 Link 기반 뒤로가기가 남아 있으면 안 된다`);
  }
});
