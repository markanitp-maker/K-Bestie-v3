"use client";

import { useEffect, useState } from "react";
import { logAuthFlowEvent } from "@/lib/analytics/authFlowClient";
import { getBrowserContext, isIOSDevice, isStandaloneDisplay, type BrowserContext } from "@/lib/pwa/standalone";

type BrowserState = "checking" | BrowserContext;

async function copyExternalBrowserAddress(): Promise<void> {
  const target = new URL(window.location.href);
  // 개인정보나 인증 정보 없이, 원래의 invite/link_id/returnUrl 문맥을 그대로 보존한다.
  target.searchParams.set("kakao_external", "1");
  const address = target.toString();

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
  document.execCommand("copy");
  textarea.remove();
}

/**
 * 카카오톡 인앱 브라우저에서는 인증·초대 UI보다 먼저 외부 브라우저 안내만 보여준다.
 * 비공식 kakaotalk:// scheme은 사용하지 않는다. 복사한 원 URL은 기존 초대 토큰과
 * returnUrl/link_id를 보존하므로 별도 개인정보 토큰을 만들 필요가 없다.
 */
export function KakaoInAppBrowserNotice({ children }: { children: React.ReactNode }) {
  const [browser, setBrowser] = useState<BrowserState>("checking");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    const context = getBrowserContext(navigator.userAgent, isStandaloneDisplay(window));
    setBrowser(context);

    if (context === "KAKAO_IN_APP") {
      void logAuthFlowEvent("kakao_link_open");
      void logAuthFlowEvent("kakao_inapp_detected");
      void logAuthFlowEvent("external_browser_cta_view");
      return;
    }

    const url = new URL(window.location.href);
    if (url.searchParams.get("kakao_external") === "1") {
      void logAuthFlowEvent("external_browser_arrived");
      url.searchParams.delete("kakao_external");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }

    if (context === "PWA_STANDALONE" && !window.sessionStorage.getItem("k_pwa_first_launch_logged")) {
      window.sessionStorage.setItem("k_pwa_first_launch_logged", "1");
      void logAuthFlowEvent("pwa_first_launch");
    }
  }, []);

  if (browser !== "KAKAO_IN_APP") {
    // UA를 읽기 전에는 가입·OAuth 버튼이 잠깐 노출되지 않도록 한다.
    if (browser === "checking") {
      return <div className="min-h-dvh bg-[var(--color-k-surface)]" aria-busy="true" />;
    }
    return <>{children}</>;
  }

  const ios = isIOSDevice(navigator.userAgent, Boolean((window as unknown as { MSStream?: unknown }).MSStream));
  const handleContinue = async () => {
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
    <main className="min-h-dvh bg-[var(--color-k-surface)] px-5 py-8 flex items-center justify-center">
      <section className="w-full max-w-md rounded-3xl bg-white border border-gray-100 shadow-sm p-6 text-center">
        <p className="text-4xl" aria-hidden>🌐</p>
        <h1 className="mt-4 text-xl font-black text-gray-900">브라우저에서 계속해 주세요</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          내친구 케이는 Safari 또는 Chrome에서 회원가입하면 더 안정적으로 이용할 수 있어요.
          <br />가입을 완료한 뒤 앱 설치도 간단하게 도와드릴게요.
        </p>
        <button
          type="button"
          onClick={() => void handleContinue()}
          className="mt-6 min-h-12 w-full rounded-2xl bg-[var(--color-k-navy)] font-bold text-white active:scale-[0.98]"
        >
          브라우저에서 계속하기
        </button>
        <p className="mt-4 text-xs leading-5 text-gray-500" aria-live="polite">
          {copied
            ? "주소를 복사했어요. 카카오톡 메뉴에서 다른 브라우저로 열거나 Safari·Chrome 주소창에 붙여 넣어 주세요."
            : copyFailed
              ? "주소를 복사하지 못했어요. 카카오톡 메뉴에서 다른 브라우저로 열어 주세요."
              : ios
                ? "카카오톡 메뉴에서 ‘Safari로 열기’를 선택해 주세요."
                : "버튼으로 이동되지 않으면 카카오톡 메뉴에서 ‘다른 브라우저로 열기’를 선택해 주세요."}
        </p>
      </section>
    </main>
  );
}
