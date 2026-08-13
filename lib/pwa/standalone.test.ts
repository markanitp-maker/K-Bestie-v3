import assert from "node:assert/strict";
import { test } from "node:test";

import {
  detectInAppBrowser,
  isIOSDevice,
  isKakaoInAppBrowser,
  isStandaloneDisplay,
  resolvePwaBrowserContext,
  type PwaBrowserSignals,
} from "./standalone.js";

function makeWin(opts: {
  displayModeStandalone?: boolean;
  navStandalone?: boolean;
  hasMatchMedia?: boolean;
}): Window {
  const { displayModeStandalone = false, navStandalone = false, hasMatchMedia = true } = opts;
  const win: {
    navigator: { standalone?: boolean };
    matchMedia?: (query: string) => { matches: boolean };
  } = {
    navigator: navStandalone ? { standalone: true } : {},
  };
  if (hasMatchMedia) {
    win.matchMedia = (query: string) => ({
      matches: query.includes("display-mode: standalone") ? displayModeStandalone : false,
    });
  }
  return win as unknown as Window;
}

function makeSignals(overrides: Partial<PwaBrowserSignals> = {}): PwaBrowserSignals {
  return {
    userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/126 Safari/537.36",
    platform: "Win32",
    maxTouchPoints: 0,
    standalone: false,
    hasInstallPrompt: false,
    ...overrides,
  };
}

test("undefined window는 설치되지 않은 것으로 간주", () => {
  assert.equal(isStandaloneDisplay(undefined), false);
});

test("display-mode 또는 navigator.standalone이면 설치됨", () => {
  assert.equal(isStandaloneDisplay(makeWin({})), false);
  assert.equal(isStandaloneDisplay(makeWin({ displayModeStandalone: true })), true);
  assert.equal(isStandaloneDisplay(makeWin({ navStandalone: true })), true);
  assert.equal(isStandaloneDisplay(makeWin({ navStandalone: true, hasMatchMedia: false })), true);
  assert.equal(isStandaloneDisplay(makeWin({ hasMatchMedia: false })), false);
});

test("iPhone/iPad UA와 desktop UA iPadOS를 iOS로 판정", () => {
  const iphoneUA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
  const ipadUA = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
  const desktopIpadUA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";

  assert.equal(isIOSDevice(iphoneUA), true);
  assert.equal(isIOSDevice(ipadUA), true);
  assert.equal(isIOSDevice(desktopIpadUA, false, "MacIntel", 5), true);
  assert.equal(isIOSDevice(desktopIpadUA, false, "MacIntel", 0), false);
});

test("Android/데스크톱/빈 UA/MSStream은 iOS 아님", () => {
  assert.equal(
    isIOSDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120"),
    false,
  );
  assert.equal(isIOSDevice("Mozilla/5.0 (Windows NT 10.0)"), false);
  assert.equal(isIOSDevice(undefined), false);
  assert.equal(isIOSDevice("iPhone", true), false);
});

test("지원 대상 In-App UA를 앱별로 판정", () => {
  assert.equal(detectInAppBrowser("KAKAOTALK/10.8.3 (INAPP)"), "kakao");
  assert.equal(detectInAppBrowser("NAVER(inapp; search; 2000; 12.15.1)"), "naver");
  assert.equal(detectInAppBrowser("NAVER (higgs; 1.0.0)"), "naver");
  assert.equal(detectInAppBrowser("Instagram 320.0.0.0 Mobile"), "instagram");
  assert.equal(detectInAppBrowser("Mobile [FBAN/FB4A;FBAV/450.0.0.0]"), "facebook");
});

test("Android WebView는 other, 일반 Safari/Chrome과 빈 UA는 In-App 아님", () => {
  const androidWebView =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36 Version/4.0 Chrome/126 Mobile Safari/537.36";
  assert.equal(detectInAppBrowser(androidWebView), "other");
  assert.equal(
    detectInAppBrowser("Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile Safari/604.1"),
    null,
  );
  assert.equal(detectInAppBrowser("Mozilla/5.0 Chrome/126 Mobile Safari/537.36"), null);
  assert.equal(detectInAppBrowser(undefined), null);
});

test("standalone이 In-App과 native prompt보다 우선", () => {
  assert.deepEqual(
    resolvePwaBrowserContext(
      makeSignals({ userAgent: "KAKAOTALK/10.8.3 (INAPP)", standalone: true, hasInstallPrompt: true }),
    ),
    { kind: "standalone" },
  );
});

test("In-App이 native prompt와 iOS Safari보다 우선", () => {
  const iosKakao =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1 KAKAOTALK/10.8.2 (INAPP)";
  assert.deepEqual(
    resolvePwaBrowserContext(
      makeSignals({ userAgent: iosKakao, platform: "iPhone", hasInstallPrompt: true }),
    ),
    { kind: "in-app-browser", app: "kakao", os: "ios" },
  );
});

test("서명이 없는 iOS WebView는 other In-App으로 안전하게 후퇴", () => {
  const iosWebView =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
  assert.deepEqual(
    resolvePwaBrowserContext(makeSignals({ userAgent: iosWebView, platform: "iPhone" })),
    { kind: "in-app-browser", app: "other", os: "ios" },
  );
});

test("native prompt가 있으면 installable-browser이며 iOS Safari보다 우선", () => {
  const iphoneSafari =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1";
  assert.deepEqual(
    resolvePwaBrowserContext(
      makeSignals({ userAgent: iphoneSafari, platform: "iPhone", hasInstallPrompt: true }),
    ),
    { kind: "installable-browser" },
  );
});

test("iPhone Safari와 desktop UA iPadOS Safari를 기기별로 구분", () => {
  const iphoneSafari =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1";
  const ipadDesktopSafari =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15";

  assert.deepEqual(
    resolvePwaBrowserContext(makeSignals({ userAgent: iphoneSafari, platform: "iPhone" })),
    { kind: "ios-safari", device: "iphone" },
  );
  assert.deepEqual(
    resolvePwaBrowserContext(
      makeSignals({ userAgent: ipadDesktopSafari, platform: "MacIntel", maxTouchPoints: 5 }),
    ),
    { kind: "ios-safari", device: "ipad" },
  );
});

test("알려진 iOS 대체 브라우저와 일반 데스크톱은 unsupported", () => {
  const iosChrome =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/126.0 Mobile/15E148 Safari/604.1";
  assert.deepEqual(
    resolvePwaBrowserContext(makeSignals({ userAgent: iosChrome, platform: "iPhone" })),
    { kind: "regular-browser-unsupported", os: "ios" },
  );
  assert.deepEqual(resolvePwaBrowserContext(makeSignals()), {
    kind: "regular-browser-unsupported",
    os: "other",
  });
  assert.deepEqual(resolvePwaBrowserContext(makeSignals({ userAgent: undefined, platform: undefined })), {
    kind: "regular-browser-unsupported",
    os: "other",
  });
});

test("Kakao In-App UA를 판정", () => {
  assert.equal(isKakaoInAppBrowser("KAKAOTALK/10.8.3 (INAPP)"), true);
  assert.equal(isKakaoInAppBrowser(undefined), false);
});
