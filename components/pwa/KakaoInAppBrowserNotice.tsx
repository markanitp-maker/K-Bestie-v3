"use client";

import { useEffect, useState } from "react";
import { logAuthFlowEvent } from "@/lib/analytics/authFlowClient";
import { getBrowserContext, isIOSDevice, isStandaloneDisplay, type BrowserContext } from "@/lib/pwa/standalone";

type BrowserState = "checking" | BrowserContext;

async function copyExternalBrowserAddress(): Promise<void> {
  // 원래의 invite token, 역할, intended redirect query를 변경하지 않은 채 복사한다.
  // 개인정보는 URL에 추가하지 않는다.
  const address = window.location.href;

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(address);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = address;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const succeeded = document.execCommand("copy");
  textarea.remove();
  if (!succeeded) {
    throw new Error("execCommand copy failed");
  }
}

/**
 * 카카오톡 인앱 브라우저 여부와 PWA standalone 실행 여부를 감지만 하는 훅이다.
 * 어떤 화면도 가로막지 않는다 — 회원가입·로그인·가족초대 등 일반 화면은 카카오
 * 인앱 브라우저에서도 항상 정상 렌더링되어야 하므로, 렌더링 차단 판단은 이 훅을
 * 쓰는 호출부(예: 앱 설치 유도 화면)가 명시적 설치 의도(installIntent)와 함께
 * 직접 결정한다.
 */
export function useKakaoInApp(): { context: BrowserState; isKakaoInApp: boolean } {
  const [browser, setBrowser] = useState<BrowserState>("checking");

  useEffect(() => {
    const context = getBrowserContext(navigator.userAgent, isStandaloneDisplay(window));
    setBrowser(context);

    if (context === "KAKAO_IN_APP") {
      // 전역 wrapper 시절엔 페이지 로드당 1회였으나, 지금은 이 훅이 각 페이지
      // 컴포넌트에서 직접 호출되어 재방문·라우트 재진입마다 다시 마운트된다 —
      // pwa_first_launch와 동일한 세션당 1회 가드를 적용한다.
      if (!window.sessionStorage.getItem("k_kakao_inapp_detected_logged")) {
        window.sessionStorage.setItem("k_kakao_inapp_detected_logged", "1");
        void logAuthFlowEvent("kakao_link_open");
        void logAuthFlowEvent("kakao_inapp_detected");
      }
      return;
    }

    if (context === "PWA_STANDALONE" && !window.sessionStorage.getItem("k_pwa_first_launch_logged")) {
      window.sessionStorage.setItem("k_pwa_first_launch_logged", "1");
      void logAuthFlowEvent("pwa_first_launch");
    }
  }, []);

  return { context: browser, isKakaoInApp: browser === "KAKAO_IN_APP" };
}

/**
 * 카카오톡 인앱 브라우저에서 앱 설치를 시도할 때만(명시적 설치 의도, installIntent)
 * 표시하는 외부 브라우저 안내 화면이다. 더 이상 전역 wrapper가 아니다 — 호출부가
 * `isKakaoInApp && installIntent`를 직접 판정해 이 컴포넌트를 마운트할 때만 보여준다.
 * 비공식 kakaotalk:// scheme은 사용하지 않는다. 복사한 원 URL은 기존 초대 토큰과
 * returnUrl/link_id를 변경 없이 보존하므로 별도 개인정보 토큰을 만들 필요가 없다.
 */
export function KakaoInAppBrowserNotice({ onClose }: { onClose?: () => void }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    void logAuthFlowEvent("external_browser_cta_view");
  }, []);

  const userAgent = navigator.userAgent;
  const ios = isIOSDevice(userAgent, Boolean((window as unknown as { MSStream?: unknown }).MSStream));
  const iPad = /iPad/i.test(userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(userAgent);
  const heading = android
    ? "Chrome 또는 다른 브라우저에서\n계속 진행해 주세요."
    : "Safari 또는 Chrome에서\n계속 진행해 주세요.";
  const guide = iPad
    ? {
        title: "iPad에서 여는 방법",
        steps: [
          "카카오 브라우저의 주소/메뉴 영역을 눌러 주세요.",
          "‘다른 브라우저로 열기’ 또는 ‘Safari에서 열기’를 선택해 주세요.",
        ],
        copiedMessage: "주소를 복사했어요.\nSafari 또는 Chrome 주소창에 붙여 주세요.",
      }
    : ios
      ? {
          title: "iPhone에서 여는 방법",
          steps: [
            "화면 오른쪽 아래\n공유 버튼을 눌러 주세요.",
            "Safari로 열기를\n선택해 주세요.",
          ],
          copiedMessage: "주소를 복사했어요.\nSafari 또는 Chrome 주소창에 붙여 주세요.",
        }
      : android
        ? {
            title: "Android에서 여는 방법",
            steps: ["카카오 브라우저의 메뉴 버튼을 눌러 주세요.", "‘다른 브라우저로 열기’를 선택해 주세요."],
            copiedMessage: "주소를 복사했어요.\nChrome 또는 다른 브라우저 주소창에 붙여 주세요.",
          }
        : {
            title: "외부 브라우저에서 여는 방법",
            steps: ["카카오 브라우저의 메뉴 버튼을 눌러 주세요.", "‘다른 브라우저로 열기’를 선택해 주세요."],
            copiedMessage: "주소를 복사했어요.\n외부 브라우저 주소창에 붙여 주세요.",
          };
  const handleCopyAddress = async () => {
    try {
      await copyExternalBrowserAddress();
      setCopied(true);
      setCopyFailed(false);
      void logAuthFlowEvent("external_browser_cta_click");
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  return (
    <main className="min-h-dvh bg-[var(--color-k-surface)] px-2 py-8 sm:px-5 flex items-center justify-center">
      <section
        className="w-full max-w-md rounded-3xl bg-white border border-gray-100 shadow-sm p-4 text-center sm:p-6"
        role="complementary"
        aria-label="카카오톡 브라우저 안내"
      >
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="닫고 계속 이용하기"
            className="mb-2 ml-auto block text-xs font-semibold text-gray-400 active:text-gray-600"
          >
            나중에 할게요 ✕
          </button>
        )}
        <p className="text-4xl" aria-hidden>🌐</p>
        <h1 className="mt-4 whitespace-pre-line text-xl font-black text-gray-900">{heading}</h1>
        <p className="mt-3 whitespace-pre-line text-base leading-6 text-gray-600">
          {"내친구 케이 앱을 안정적으로 설치하기\n위해서는 외부 브라우저를 열어 주세요."}
        </p>
        <div className="mt-6 rounded-2xl bg-[var(--color-k-surface)] p-3 text-left sm:p-4">
          <h2 className="text-base font-bold text-gray-900">{guide.title}</h2>
          <ol className={`mt-3 list-decimal pl-4 text-[clamp(0.6875rem,3.75vw,1rem)] leading-5 tracking-[-0.04em] text-gray-700 sm:pl-5 sm:leading-6 sm:tracking-normal ${ios ? "space-y-6" : "space-y-2"}`}>
            {guide.steps.map((step) => <li key={step} className="whitespace-pre-line">{step}</li>)}
          </ol>
        </div>
        {ios && (
          <div className="mt-4 rounded-2xl bg-[var(--color-k-surface)] p-3 text-left sm:p-4">
            <h2 className="text-base font-bold text-gray-900">앱 설치하는 방법</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-4 text-[clamp(0.6875rem,3.75vw,1rem)] leading-5 tracking-[-0.04em] text-gray-700 sm:pl-5 sm:leading-6 sm:tracking-normal">
              <li className="whitespace-pre-line">{"Safari의 공유 버튼을\n눌러 주세요."}</li>
              <li className="whitespace-pre-line">{"홈 화면에 추가를\n선택해 주세요."}</li>
              <li className="whitespace-pre-line">{"웹 앱으로 열기를 켜고\n추가를 눌러 주세요."}</li>
            </ol>
          </div>
        )}
        <p className="mt-4 text-xs leading-5 text-gray-500">
          카카오톡 버전에 따라 메뉴 위치와 이름이 다를 수 있어요.
        </p>
        <button
          type="button"
          onClick={() => void handleCopyAddress()}
          className="mt-5 min-h-12 w-full rounded-2xl border border-gray-200 bg-white font-bold text-gray-700 active:scale-[0.98]"
        >
          주소 복사하기
        </button>
        <p
          className={`mt-3 min-h-10 whitespace-pre-line text-center text-[clamp(0.75rem,3.75vw,0.875rem)] font-semibold leading-5 tracking-[-0.03em] sm:tracking-normal ${copied ? "text-red-600" : copyFailed ? "text-gray-500" : ""}`}
          aria-live="polite"
        >
          {copied
            ? guide.copiedMessage
            : copyFailed
              ? "주소를 복사하지 못했어요.\n주소를 길게 눌러 직접 복사해 주세요."
              : null}
        </p>
      </section>
    </main>
  );
}
