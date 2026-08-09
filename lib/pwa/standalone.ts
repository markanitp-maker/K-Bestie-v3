// lib/pwa/standalone.ts
// PWA 설치/실행 상태 감지를 위한 순수 함수 모음.
// 브라우저 전역(window/navigator)에 직접 의존하지 않고 인자로 주입받아
// 테스트 가능하도록 분리한다. 어떤 네트워크/API도 호출하지 않는다.

/**
 * 앱이 이미 설치되어 standalone(홈 화면 실행) 모드로 동작 중인지 감지한다.
 * - Android/Chrome/데스크톱: `matchMedia('(display-mode: standalone)')`
 * - iOS/iPadOS Safari: 비표준 `navigator.standalone === true`
 * 둘 중 하나라도 참이면 설치된 것으로 간주한다.
 */
export function isStandaloneDisplay(win: Window | undefined): boolean {
  if (!win) return false;
  const mqStandalone =
    typeof win.matchMedia === "function" &&
    win.matchMedia("(display-mode: standalone)").matches === true;
  const navStandalone = (win.navigator as unknown as { standalone?: boolean })?.standalone === true;
  return mqStandalone || navStandalone;
}

/**
 * 사용자 에이전트 문자열로 iOS/iPadOS 기기 여부를 감지한다.
 * iOS Safari는 `beforeinstallprompt`를 지원하지 않으므로, 설치 안내 문구로
 * 분기하기 위해 사용한다.
 */
export function isIOSDevice(userAgent: string | undefined, hasMSStream = false): boolean {
  if (!userAgent) return false;
  return /iPad|iPhone|iPod/.test(userAgent) && !hasMSStream;
}

/**
 * 카카오톡 인앱 브라우저 여부를 감지한다.
 * 카카오 공식 문서에 명시된 User-Agent의 `KAKAOTALK` 표식을 기준으로만 판정한다.
 */
export function isKakaoInAppBrowser(userAgent: string | undefined): boolean {
  if (!userAgent) return false;
  return /KAKAOTALK/i.test(userAgent);
}

export type BrowserContext = "KAKAO_IN_APP" | "NORMAL_BROWSER" | "PWA_STANDALONE";

/**
 * 가입 전에 외부 브라우저 전환이 필요한지 판정한다. standalone을 먼저 확인해
 * 설치된 PWA가 카카오 UA 표식을 우연히 포함하더라도 서비스 진입을 막지 않는다.
 */
export function getBrowserContext(
  userAgent: string | undefined,
  isStandalone: boolean,
): BrowserContext {
  if (isStandalone) return "PWA_STANDALONE";
  return isKakaoInAppBrowser(userAgent) ? "KAKAO_IN_APP" : "NORMAL_BROWSER";
}
