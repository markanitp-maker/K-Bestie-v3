"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export function FamilyInviteContinue({ oauthCancelled = false }: { oauthCancelled?: boolean }) {
  const started = useRef(false);
  const [message, setMessage] = useState(oauthCancelled ? "로그인이 취소됐지만 초대는 아직 사용 가능해요." : "가족 참여를 안전하게 처리하고 있어요...");
  const [error, setError] = useState<string | null>(null);
  const [providerLoading, setProviderLoading] = useState<"google" | "kakao" | null>(null);

  useEffect(() => {
    if (oauthCancelled) return;
    if (started.current) return;
    started.current = true;
    fetch("/api/family-invites/consume", { method: "POST" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (response.status === 428 && (body.onboardingStep === "consent" || body.onboardingStep === "profile")) {
          window.location.replace(`/signup?step=${encodeURIComponent(body.onboardingStep)}&familyInvite=1`);
          return;
        }
        if (!response.ok) throw new Error(body.error || "가족 참여에 실패했습니다.");
        setMessage(body.alreadyMember ? "이미 가족에 참여되어 있어요." : "가족 참여가 완료됐어요!");
        window.setTimeout(() => window.location.replace("/parent/home"), 700);
      })
      .catch((reason: Error) => {
        setError(reason.message);
      });
  }, [oauthCancelled]);

  async function retryOAuth(provider: "google" | "kakao") {
    setProviderLoading(provider);
    setError(null);
    const origin = window.location.origin.replace("//0.0.0.0", "//localhost");
    const { error: oauthError } = await createClient().auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${origin}/auth/callback?returnUrl=${encodeURIComponent("/family/invite/continue")}` },
    });
    if (oauthError) {
      setError(oauthError.message);
      setProviderLoading(null);
    }
  }

  return (
    <main className="min-h-dvh bg-[var(--color-k-surface)] px-5 py-8 flex items-center justify-center">
      <section className="w-full max-w-md rounded-3xl bg-white border border-gray-100 shadow-sm p-7 text-center">
        <h1 className="text-xl font-black text-gray-900">가족 구성원으로 참여하기</h1>
        {!error ? <p className="mt-4 text-sm text-gray-600">{message}</p> : (
          <>
            <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>
            <Link href="/login" className="inline-flex mt-5 min-h-12 px-5 items-center justify-center rounded-xl bg-[var(--color-k-navy)] text-white font-bold">로그인 화면으로</Link>
          </>
        )}
        {oauthCancelled && (
          <div className="mt-5 flex flex-col gap-3">
            <button type="button" onClick={() => retryOAuth("google")} disabled={providerLoading !== null} className="min-h-12 rounded-xl border border-gray-200 bg-white font-bold text-gray-800 disabled:opacity-50">
              {providerLoading === "google" ? "Google 연결 중..." : "Google로 다시 계속하기"}
            </button>
            <button type="button" onClick={() => retryOAuth("kakao")} disabled={providerLoading !== null} className="min-h-12 rounded-xl bg-[#FEE500] font-bold text-[#191919] disabled:opacity-50">
              {providerLoading === "kakao" ? "Kakao 연결 중..." : "Kakao로 다시 계속하기"}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
