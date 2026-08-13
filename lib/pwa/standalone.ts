// PWA 설치/실행 상태와 브라우저 환경을 판별하는 순수 함수 모음.
// 브라우저 전역(window/navigator)에 직접 의존하지 않고 인자로 주입받아 테스트한다.

export type InAppBrowserApp = "kakao" | "naver" | "instagram" | "facebook" | "other";
export type PwaBrowserOs = "ios" | "android" | "other";
export type IosDevice = "iphone" | "ipad";

export type PwaBrowserContext =
  | { kind: "standalone" }
  | { kind: "in-app-browser"; app: InAppBrowserApp; os: PwaBrowserOs }
  | { kind: "installable-browser" }
  | { kind: "ios-safari"; device: IosDevice }
  | { kind: "regular-browser-unsupported"; os: PwaBrowserOs };

export interface PwaBrowserSignals {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone: boolean;
  hasInstallPrompt: boolean;
  hasMSStream?: boolean;
}

/**
 * 앱이 이미 설치되어 standalone(홈 화면 실행) 모드로 동작 중인지 감지한다.
 * Android/Chromium의 display-mode와 iOS의 navigator.standalone을 함께 확인한다.
 */
export function isStandaloneDisplay(win: Window | undefined): boolean {
  if (!win) return false;
  const mqStandalone =
    typeof win.matchMedia === "function" &&
    win.matchMedia("(display-mode: standalone)").matches === true;
  const navStandalone =
    (win.navigator as unknown as { standalone?: boolean })?.standalone === true;
  return mqStandalone || navStandalone;
}

function isDesktopModeIPad(platform: string | undefined, maxTouchPoints: number): boolean {
  return platform === "MacIntel" && maxTouchPoints > 1;
}

/**
 * 기존 호출부 호환용 iOS 판별 함수. 세 번째/네 번째 인자를 전달하면 desktop UA를 쓰는
 * iPadOS도 감지한다.
 */
export function isIOSDevice(
  userAgent: string | undefined,
  hasMSStream = false,
  platform?: string,
  maxTouchPoints = 0,
): boolean {
  if (hasMSStream) return false;
  const iosUserAgent = Boolean(userAgent && /iPad|iPhone|iPod/i.test(userAgent));
  return iosUserAgent || isDesktopModeIPad(platform, maxTouchPoints);
}

function getIosDevice(
  userAgent: string,
  platform: string | undefined,
  maxTouchPoints: number,
  hasMSStream: boolean,
): IosDevice | null {
  if (!isIOSDevice(userAgent, hasMSStream, platform, maxTouchPoints)) return null;
  if (/iPad/i.test(userAgent) || isDesktopModeIPad(platform, maxTouchPoints)) return "ipad";
  return "iphone";
}

/** 카카오톡 공식 UA의 KAKAOTALK 표식을 기준으로 판정한다. */
export function isKakaoInAppBrowser(userAgent: string | undefined): boolean {
  return Boolean(userAgent && /KAKAOTALK/i.test(userAgent));
}

export function detectInAppBrowser(userAgent: string | undefined): InAppBrowserApp | null {
  if (!userAgent) return null;
  if (isKakaoInAppBrowser(userAgent)) return "kakao";
  if (/NAVER\s*\(\s*(?:inapp|higgs)\b/i.test(userAgent)) return "naver";
  if (/Instagram/i.test(userAgent)) return "instagram";
  if (/FBAN|FBAV/i.test(userAgent)) return "facebook";

  const androidWebView =
    /;\s*wv\)/i.test(userAgent) || /Version\/4\.0[^)]*\bwv\b/i.test(userAgent);
  if (androidWebView) return "other";

  return null;
}

function getBrowserOs(
  userAgent: string,
  platform: string | undefined,
  maxTouchPoints: number,
  hasMSStream: boolean,
): PwaBrowserOs {
  if (isIOSDevice(userAgent, hasMSStream, platform, maxTouchPoints)) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "other";
}

function isIosSafari(userAgent: string, device: IosDevice | null): boolean {
  if (!device) return false;
  const hasSafariEngine = /AppleWebKit/i.test(userAgent) && /Safari/i.test(userAgent);
  const isKnownAlternativeBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent);
  return hasSafariEngine && !isKnownAlternativeBrowser;
}

function isUnknownIosWebView(userAgent: string, device: IosDevice | null): boolean {
  if (!device) return false;
  const hasWebKitMobile = /AppleWebKit/i.test(userAgent) && /Mobile/i.test(userAgent);
  const hasSafariToken = /Safari/i.test(userAgent);
  const isKnownAlternativeBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent);
  return hasWebKitMobile && !hasSafariToken && !isKnownAlternativeBrowser;
}

/**
 * 설치 행동의 단일 환경 판별기. 우선순위는 반드시
 * standalone → in-app → native prompt → iOS Safari → unsupported 순서다.
 */
export function resolvePwaBrowserContext(signals: PwaBrowserSignals): PwaBrowserContext {
  if (signals.standalone) return { kind: "standalone" };

  const userAgent = signals.userAgent ?? "";
  const platform = signals.platform;
  const maxTouchPoints = signals.maxTouchPoints ?? 0;
  const hasMSStream = signals.hasMSStream ?? false;
  const os = getBrowserOs(userAgent, platform, maxTouchPoints, hasMSStream);
  const iosDevice = getIosDevice(userAgent, platform, maxTouchPoints, hasMSStream);
  const detectedInApp = detectInAppBrowser(userAgent);

  if (detectedInApp) return { kind: "in-app-browser", app: detectedInApp, os };
  if (isUnknownIosWebView(userAgent, iosDevice)) {
    return { kind: "in-app-browser", app: "other", os };
  }
  if (signals.hasInstallPrompt) return { kind: "installable-browser" };
  if (iosDevice && isIosSafari(userAgent, iosDevice)) {
    return { kind: "ios-safari", device: iosDevice };
  }
  return { kind: "regular-browser-unsupported", os };
}
