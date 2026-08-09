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
 * 카카오톡 인앱 브라우저에서는 인증·초대 UI보다 먼저 외부 브라우저 안내만 보여준다.
 * 비공식 kakaotalk:// scheme은 사용하지 않는다. 복사한 원 URL은 기존 초대 토큰과
 * returnUrl/link_id를 변경 없이 보존하므로 별도 개인정보 토큰을 만들 필요가 없다.
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
    <main className="min-h-dvh bg-[var(--color-k-surface)] px-5 py-8 flex items-center justify-center">
      <section
        className="w-full max-w-md rounded-3xl bg-white border border-gray-100 shadow-sm p-6 text-center"
        role="complementary"
        aria-label="카카오톡 브라우저 안내"
      >
        <p className="text-4xl" aria-hidden>🌐</p>
        <h1 className="mt-4 text-xl font-black text-gray-900">Safari 또는 Chrome에서 계속해 주세요</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          회원가입과 앱 설치를 안정적으로 진행하려면 외부 브라우저에서 열어 주세요.
        </p>
        <div className="mt-6 rounded-2xl bg-[var(--color-k-surface)] p-4 text-left">
          <h2 className="text-sm font-bold text-gray-900">{ios ? "iPhone에서 여는 방법" : "Android에서 여는 방법"}</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-gray-700">
            {ios ? (
              <>
                <li>카카오 브라우저의 주소/메뉴 영역을 눌러 주세요.</li>
                <li>‘다른 브라우저로 열기’ 또는 ‘Safari에서 열기’를 선택해 주세요.</li>
              </>
            ) : (
              <>
                <li>오른쪽 아래 메뉴(⋮)를 눌러 주세요.</li>
                <li>‘다른 브라우저로 열기’를 선택해 주세요.</li>
              </>
            )}
          </ol>
        </div>
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
        <p className="mt-3 text-xs leading-5 text-gray-500" aria-live="polite">
          {copied
            ? "주소를 복사했어요. Safari 또는 Chrome 주소창에 붙여 넣어 주세요."
            : copyFailed
              ? "주소를 복사하지 못했어요. 카카오톡 메뉴에서 다른 브라우저로 열어 주세요."
              : "메뉴를 찾기 어렵다면 주소를 복사해 Safari 또는 Chrome 주소창에 붙여 넣어 주세요."}
        </p>
      </section>
    </main>
  );
}
