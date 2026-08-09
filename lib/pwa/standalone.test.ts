// PWA standalone/iOS 감지 순수 함수 단위 테스트 — node:test 내장 러너(npm test).
// display-mode 감지는 실제 OS 설치 없이 window.matchMedia / navigator.standalone을
// 목(mock)으로 주입해 "설치됨/미설치" 양쪽 분기를 결정적으로 검증한다.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isStandaloneDisplay,
  isIOSDevice,
  isKakaoInAppBrowser,
  getBrowserContext,
} from "./standalone.js";

function makeWin(opts: {
  displayModeStandalone?: boolean;
  navStandalone?: boolean;
  hasMatchMedia?: boolean;
}): Window {
  const { displayModeStandalone = false, navStandalone = false, hasMatchMedia = true } = opts;
  const win: any = {
    navigator: navStandalone ? { standalone: true } : {},
  };
  if (hasMatchMedia) {
    win.matchMedia = (query: string) => ({
      matches: query.includes("display-mode: standalone") ? displayModeStandalone : false,
    });
  }
  return win as Window;
}

test("undefined window는 설치되지 않은 것으로 간주", () => {
  assert.equal(isStandaloneDisplay(undefined), false);
});

test("일반 브라우저 탭(둘 다 false)은 미설치", () => {
  assert.equal(isStandaloneDisplay(makeWin({})), false);
});

test("Android/Chrome display-mode: standalone이면 설치됨", () => {
  assert.equal(isStandaloneDisplay(makeWin({ displayModeStandalone: true })), true);
});

test("iOS navigator.standalone === true이면 설치됨", () => {
  assert.equal(isStandaloneDisplay(makeWin({ navStandalone: true })), true);
});

test("matchMedia가 없어도(navigator.standalone만) 안전하게 감지", () => {
  assert.equal(isStandaloneDisplay(makeWin({ navStandalone: true, hasMatchMedia: false })), true);
  assert.equal(isStandaloneDisplay(makeWin({ hasMatchMedia: false })), false);
});

test("iOS 기기 UA는 iOS로 판정", () => {
  const iphoneUA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
  const ipadUA = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
  assert.equal(isIOSDevice(iphoneUA), true);
  assert.equal(isIOSDevice(ipadUA), true);
});

test("Android/데스크톱 UA는 iOS 아님", () => {
  const androidUA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120";
  assert.equal(isIOSDevice(androidUA), false);
  assert.equal(isIOSDevice("Mozilla/5.0 (Windows NT 10.0)"), false);
});

test("빈 UA / MSStream(IE mobile)은 iOS 아님", () => {
  assert.equal(isIOSDevice(undefined), false);
  assert.equal(isIOSDevice("iPhone", true), false);
});

test("카카오톡 공식 UA 표식이 있으면 인앱 브라우저로 판정", () => {
  const iosKakao =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) Mobile/15E148 Safari/604.1 KAKAOTALK/10.8.2 (INAPP)";
  const androidKakao =
    "Mozilla/5.0 (Linux; Android 14; SM-S908N) Chrome/126 Mobile Safari/537.36 KAKAOTALK/10.8.3 (INAPP)";
  assert.equal(isKakaoInAppBrowser(iosKakao), true);
  assert.equal(isKakaoInAppBrowser(androidKakao), true);
});

test("일반 Safari·Chrome은 카카오톡 인앱 브라우저가 아님", () => {
  assert.equal(
    isKakaoInAppBrowser("Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Safari/604.1"),
    false
  );
  assert.equal(isKakaoInAppBrowser("Mozilla/5.0 Chrome/126 Mobile Safari/537.36"), false);
  assert.equal(isKakaoInAppBrowser(undefined), false);
});

test("카카오 인앱·일반 브라우저·설치 PWA를 안전하게 구분한다", () => {
  assert.equal(getBrowserContext("KAKAOTALK/10.8.3 (INAPP)", false), "KAKAO_IN_APP");
  assert.equal(getBrowserContext("Mozilla/5.0 Chrome/126", false), "NORMAL_BROWSER");
  assert.equal(getBrowserContext("KAKAOTALK/10.8.3 (INAPP)", true), "PWA_STANDALONE");
});
