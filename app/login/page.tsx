"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { KakaoInAppBrowserNotice } from "@/components/pwa/KakaoInAppBrowserNotice";
import { safeReturnUrl } from "@/lib/auth/safeReturnUrl";
import { logAuthFlowEvent } from "@/lib/analytics/authFlowClient";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnUrl = safeReturnUrl(searchParams.get("returnUrl"));
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loadingMember, setLoadingMember] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const errorParam = searchParams.get("error");
    if (errorParam === "auth") {
      setError("로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      void logAuthFlowEvent("social_auth_failed");
    } else if (errorParam === "cancelled") {
      setError("로그인이 취소되었습니다. 다시 시도해 주세요.");
    }
  }, [searchParams]);

  const handleOAuthLogin = async (provider: "google" | "kakao") => {
    setLoadingProvider(provider);
    setError(null);
    const supabase = createClient();
    
    localStorage.setItem("login_role", "owner");
    await logAuthFlowEvent("social_auth_provider_selected", { provider });

    // 접속한 실제 도메인을 그대로 사용; 0.0.0.0만 localhost로 치환
    const appOrigin = window.location.origin.replace("//0.0.0.0", "//localhost");
    const redirectTo = `${appOrigin}/auth/callback${
      returnUrl !== "/" ? `?returnUrl=${encodeURIComponent(returnUrl)}` : ""
    }`;

    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
      },
    });

    if (authError) {
      setError("로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setLoadingProvider(null);
    }
  };

  const handleMemberLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("아이디와 비밀번호를 입력해주세요.");
      return;
    }
    setLoadingMember(true);
    setError(null);

    const supabase = createClient();
    
    // 구성원 로그인 플래그 세팅
    localStorage.setItem("login_role", "member");

    // 가짜 도메인 조합 (사용자에게 노출 없음)
    const authEmail = `${username.trim()}@kbestie.local`;
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password,
    });

    if (authError) {
      setError("아이디 또는 비밀번호가 올바르지 않아요.");
      setLoadingMember(false);
      return;
    }

    fetch("/api/analytics/login", { method: "POST" }).catch(() => {});

    if (returnUrl !== "/") {
      router.push(returnUrl);
    } else {
      router.push("/");
    }
    router.refresh();
  };

  const isLoading = loadingProvider !== null || loadingMember;

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center px-5 md:max-w-[420px] md:mx-auto w-full py-8"
      style={{ background: "var(--color-k-surface)" }}
    >
      <KakaoInAppBrowserNotice />
      <div className="text-center mb-8">
        <div className="relative w-[112px] h-[112px] mx-auto mb-3">
          <Image
            src="/Images/mascot/mascot-standing.png"
            alt="내친구 케이 마스코트"
            fill
            priority
            className="object-contain"
          />
        </div>
        <h1 className="text-xl font-bold text-gray-900">내친구 케이</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-k-text-secondary)" }}>
          아이의 마음을 함께 돌봐요
        </p>
      </div>

      <Link href="/" className="mb-4 text-sm font-medium text-gray-500 hover:text-gray-700">
        ← 뒤로 가기
      </Link>

      <div className="w-full flex flex-col gap-6 bg-white/70 backdrop-blur-md rounded-3xl p-6 shadow-sm border border-white/50">
        {error && (
          <div
            className="rounded-xl px-4 py-3 text-xs font-medium text-center"
            style={{ background: "#FEF2F2", color: "#DC2626" }}
          >
            {error}
          </div>
        )}

        {/* ── 오너 소셜 로그인 섹션 ── */}
        <div className="flex flex-col gap-2.5">
          <p className="text-xs font-bold text-gray-500 mb-1 px-1">보호자 로그인</p>
          
          <button
            onClick={() => handleOAuthLogin("kakao")}
            disabled={isLoading}
            className="w-full py-3.5 rounded-xl font-bold text-gray-900 text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
            style={{
              background: "#FEE500",
              boxShadow: "0 2px 8px rgba(254, 229, 0, 0.15)",
            }}
          >
            <svg className="w-5 h-5 fill-current text-gray-900" viewBox="0 0 24 24">
              <path d="M12 3c-4.97 0-9 3.185-9 7.115 0 2.557 1.707 4.8 4.27 6.007-.188.702-.68 2.531-.777 2.896-.12.454.148.448.31.341.127-.083 2.012-1.366 2.825-1.922.449.124.919.193 1.372.193 4.97 0 9-3.186 9-7.115C21 6.185 16.97 3 12 3z" />
            </svg>
            {loadingProvider === "kakao" ? "연결 중..." : "카카오로 계속하기"}
          </button>

          <button
            onClick={() => handleOAuthLogin("google")}
            disabled={isLoading}
            className="w-full py-3.5 rounded-xl font-bold text-gray-700 text-sm flex items-center justify-center gap-2 border border-gray-200 transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
            style={{
              background: "white",
              boxShadow: "var(--shadow-k-card)",
            }}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            {loadingProvider === "google" ? "연결 중..." : "구글로 계속하기"}
          </button>
        </div>

        {/* 구분선 */}
        <div className="flex items-center gap-3 py-1">
          <div className="flex-1 h-px bg-gray-100" />
          <span className="text-[10px] font-bold text-gray-400">또는</span>
          <div className="flex-1 h-px bg-gray-100" />
        </div>

        {/* ── 구성원 일반 로그인 섹션 ── */}
        <form onSubmit={handleMemberLogin} className="flex flex-col gap-3">
          <p className="text-xs font-bold text-gray-500 mb-1 px-1">아이 로그인</p>
          
          <div>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="아이 아이디를 입력하세요"
              disabled={isLoading}
              className="w-full rounded-xl px-4 py-3 text-sm border-2 border-transparent outline-none transition-colors"
              style={{ background: "#F9FAF6", border: "1px solid rgba(26,107,90,0.12)" }}
              onFocus={(e) => (e.target.style.borderColor = "var(--color-k-navy)")}
              onBlur={(e) => (e.target.style.borderColor = "transparent")}
            />
          </div>

          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호를 입력하세요"
              disabled={isLoading}
              className="w-full rounded-xl px-4 py-3 text-sm border-2 border-transparent outline-none transition-colors"
              style={{ background: "#F9FAF6", border: "1px solid rgba(26,107,90,0.12)" }}
              onFocus={(e) => (e.target.style.borderColor = "var(--color-k-navy)")}
              onBlur={(e) => (e.target.style.borderColor = "transparent")}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading || !username.trim() || !password}
            className="w-full py-3.5 rounded-xl font-bold text-white text-sm disabled:opacity-50 transition-opacity active:opacity-80 cursor-pointer mt-1"
            style={{ background: "var(--color-k-navy)" }}
          >
            {loadingMember ? "로그인 중..." : "로그인"}
          </button>
        </form>
      </div>

      <div className="mt-8 text-center">
        <p className="text-xs text-gray-400">
          오너가 먼저 아이 계정을 발급해 주어야 로그인할 수 있어요.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback = {
        <div className="min-h-dvh flex flex-col items-center justify-center bg-gray-50" >
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-k-navy) var(--color-k-navy) transparent transparent" }} />
          <p className="text-xs text-gray-500 mt-3">로그인 화면을 불러오는 중...</p>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
