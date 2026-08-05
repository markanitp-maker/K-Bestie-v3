"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { KakaoInAppBrowserNotice } from "@/components/pwa/KakaoInAppBrowserNotice";

const PWA_INTRO_SEEN_KEY = "k_pwa_intro_seen";

// REQUEST-AUTH-SIGNUP-AUTOLOGIN §10: 이 화면은 이제 회원가입 여부와 무관하게 도달할 수
// 있는 화면이 아니다 — 루트 페이지(app/page.tsx)가 서버 검증된 멤버십 상태가
// ACTIVE_PARENT/ACTIVE_CHILD일 때만, 그리고 이 브라우저에서 아직 안내를 본 적이 없을
// 때만 여기로 보낸다(?next=/parent/home 또는 ?next=/child/home). 회원가입 진행 중인
// 사용자는 애초에 여기 도달하지 않고 /signup으로 간다.
function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") === "/child/home" ? "/child/home" : "/parent/home";
  const { installPrompt, isIOS, isStandalone, handleInstall } = useInstallPrompt();

  const proceed = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PWA_INTRO_SEEN_KEY, "1");
    }
    router.replace(next);
  };

  const onInstallClick = async () => {
    await handleInstall();
    proceed();
  };

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center p-6"
      style={{ background: "var(--color-k-surface)" }}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm p-6 flex flex-col gap-6 text-center">
        <KakaoInAppBrowserNotice />
        <div>
          <p className="text-5xl mb-3">📲</p>
          <h1 className="text-lg font-bold" style={{ color: "var(--color-k-text-primary)" }}>
            내친구 케이에 오신 것을 환영해요
          </h1>
          <p className="text-xs mt-2 leading-relaxed" style={{ color: "var(--color-k-text-secondary)" }}>
            홈 화면에 추가하면 앱처럼 더 빠르고 편하게 이용할 수 있어요.
          </p>
        </div>

        {!isStandalone && (
          <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: "var(--color-k-surface)", border: "1px solid var(--color-k-border)" }}>
            {isIOS ? (
              <p className="text-xs leading-relaxed" style={{ color: "var(--color-k-text-secondary)" }}>
                Safari 하단에 <strong>공유 버튼</strong>을 누른 뒤, <strong>&quot;더 보기&quot;</strong> 버튼을 누르세요.
                <br />
                맨 아래 <strong>&quot;홈 화면에 추가&quot;</strong>를 선택하시면 됩니다.
              </p>
            ) : installPrompt ? (
              <button
                type="button"
                onClick={onInstallClick}
                className="w-full py-3 rounded-xl text-white text-sm font-bold active:scale-95 transition-transform"
                style={{ background: "var(--color-k-navy)" }}
              >
                홈 화면에 추가하기
              </button>
            ) : (
              <p className="text-xs leading-relaxed" style={{ color: "var(--color-k-text-secondary)" }}>
                브라우저 메뉴에서 &quot;홈 화면에 추가&quot; 또는 &quot;앱 설치&quot;를 선택하면 더 편하게 이용할 수 있어요.
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={proceed}
          className="w-full py-3.5 rounded-2xl font-bold text-sm active:scale-[0.98] transition-transform"
          style={
            isStandalone
              ? { background: "var(--color-k-navy)", color: "#fff" }
              : { background: "#fff", color: "var(--color-k-text-secondary)", border: "1px solid var(--color-k-border)" }
          }
        >
          {isStandalone ? "시작하기 →" : "나중에 할게요 →"}
        </button>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh flex flex-col items-center justify-center bg-gray-50">
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-k-navy) var(--color-k-navy) transparent transparent" }} />
        </div>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}
