"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PwaInstallGuideModal } from "@/components/pwa/PwaInstallGuideModal";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { safePostAuthReturnUrl } from "@/lib/auth/safeReturnUrl";
import { logAuthFlowEvent } from "@/lib/analytics/authFlowClient";

const PWA_INTRO_SEEN_KEY = "k_pwa_intro_seen";

// REQUEST-AUTH-SIGNUP-AUTOLOGIN §10: 이 화면은 이제 회원가입 여부와 무관하게 도달할 수
// 있는 화면이 아니다 — 루트 페이지(app/page.tsx)가 서버 검증된 멤버십 상태가
// ACTIVE_PARENT/ACTIVE_CHILD일 때만, 그리고 이 브라우저에서 아직 안내를 본 적이 없을
// 때만 여기로 보낸다(?next=/parent/home 또는 ?next=/child/home). 회원가입 진행 중인
// 사용자는 애초에 여기 도달하지 않고 /signup으로 간다.
function OnboardingContent() {
  const router = useRouter();
  const rawSearchParams = useSearchParams();
  const searchParams = rawSearchParams ?? new URLSearchParams();
  const requestedNext = safePostAuthReturnUrl(searchParams.get("next"));
  const next = requestedNext === "/" ? "/parent/home" : requestedNext;
  const isChild = next === "/child/home" || next.startsWith("/child/");
  const {
    context,
    isReady,
    canShowInstallEntry,
    activeGuide,
    guideContext,
    requestInstall,
    closeGuide,
  } = useInstallPrompt();
  const isStandalone = context.kind === "standalone";

  useEffect(() => {
    if (isReady && canShowInstallEntry) void logAuthFlowEvent("pwa_install_offer_view");
  }, [canShowInstallEntry, isReady]);

  useEffect(() => {
    fetch("/api/auth/membership-status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((status) => {
        if (status?.state === "AUTHENTICATED_INCOMPLETE") {
          window.location.replace(`/signup?step=${status.onboardingStep ?? "consent"}`);
        } else if (status?.state === "RESTOREABLE_WITHDRAWN") {
          window.location.replace("/account/withdrawn");
        }
      })
      .catch(() => {});
  }, []);

  const proceed = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PWA_INTRO_SEEN_KEY, "1");
    }
    router.replace(next);
  };

  const onInstallClick = async () => {
    void logAuthFlowEvent("pwa_install_click");
    const outcome = await requestInstall();
    if (outcome === "accepted") void logAuthFlowEvent("pwa_installed");
    if (outcome === "accepted" || outcome === "dismissed") proceed();
  };

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center p-6"
      style={{ background: "var(--color-k-surface)" }}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm p-6 flex flex-col gap-6 text-center">
        <div>
          <p className="text-5xl mb-3">📲</p>
          <h1 className="text-lg font-bold" style={{ color: "var(--color-k-text-primary)" }}>
            {isChild ? "케이를 홈 화면에 추가해 볼까?" : "내친구 케이를 앱으로 사용해 보세요"}
          </h1>
          <p className="text-xs mt-2 leading-relaxed" style={{ color: "var(--color-k-text-secondary)" }}>
            {isChild
              ? "앱으로 설치하면 미션이 시작될 때 케이가 알려줄 수 있어."
              : "홈 화면에 설치하면 매일 아침 아이 리포트가 준비됐을 때 알려드려요."}
          </p>
        </div>

        {isReady && canShowInstallEntry && (
          <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: "var(--color-k-surface)", border: "1px solid var(--color-k-border)" }}>
            <button
              type="button"
              onClick={onInstallClick}
              className="w-full py-3 rounded-xl text-white text-sm font-bold active:scale-95 transition-transform"
              style={{ background: "var(--color-k-navy)" }}
            >
              앱 설치하기
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => { void logAuthFlowEvent("pwa_install_dismiss"); proceed(); }}
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
      <PwaInstallGuideModal
        isOpen={activeGuide !== null}
        context={guideContext ?? context}
        onClose={closeGuide}
      />
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
