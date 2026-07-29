"use client";

import { useRouter } from "next/navigation";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";

// 053: 회원가입 직후 첫 화면. PWA 설치 안내를 먼저 보여준 뒤, "가족 만들기"/
// "가족 구성원으로 참여하기"로 이어간다. 그 두 버튼과 실제 가족 생성/참여 신청
// 로직은 /parent/home이 가족이 없는 사용자에게 이미 그대로 보여주고 있으므로
// (기존에 검증된 흐름을 그대로 재사용 — 여기서 중복 구현하지 않는다), 이 화면은
// PWA 설치 게이트 역할만 하고 다음 단계로 넘긴다.
export default function OnboardingPage() {
  const router = useRouter();
  const { installPrompt, isIOS, isStandalone, handleInstall } = useInstallPrompt();

  const proceed = () => router.replace("/parent/home");

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
