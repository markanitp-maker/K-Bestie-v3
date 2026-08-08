"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type InviteState = "loading" | "pending" | "consumed" | "revoked" | "expired" | "invalid";

export function FamilyInviteJoin({ initialToken }: { initialToken?: string }) {
  const [token] = useState(initialToken || "");
  const [code, setCode] = useState("");
  const [submittedCode, setSubmittedCode] = useState("");
  const [state, setState] = useState<InviteState>(initialToken ? "loading" : "invalid");
  const [familyName, setFamilyName] = useState("");
  const [inviterName, setInviterName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingProvider, setLoadingProvider] = useState<"google" | "kakao" | "session" | null>(null);

  const credential = token ? { token } : submittedCode ? { code: submittedCode } : null;

  useEffect(() => {
    if (!credential) return;
    let cancelled = false;
    setState("loading");
    setError(null);
    fetch("/api/family-invites/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credential),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok && response.status !== 404) throw new Error(body.error || "초대 정보를 확인하지 못했습니다.");
        if (cancelled) return;
        setState((body.state || "invalid") as InviteState);
        setFamilyName(body.familyName || "");
        setInviterName(body.inviterName || "");
      })
      .catch((reason: Error) => {
        if (!cancelled) {
          setState("invalid");
          setError(reason.message);
        }
      });
    return () => { cancelled = true; };
    // credential values are stable strings; object identity must not retrigger resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, submittedCode]);

  async function saveContext(): Promise<void> {
    if (!credential) throw new Error("초대 정보가 없습니다.");
    const response = await fetch("/api/family-invites/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credential),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "초대 정보를 저장하지 못했습니다.");
  }

  async function continueWith(provider: "google" | "kakao") {
    setLoadingProvider(provider);
    setError(null);
    try {
      await saveContext();
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        window.location.assign("/family/invite/continue");
        return;
      }
      const origin = window.location.origin.replace("//0.0.0.0", "//localhost");
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${origin}/auth/callback?returnUrl=${encodeURIComponent("/family/invite/continue")}` },
      });
      if (oauthError) throw oauthError;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "로그인을 시작하지 못했습니다.");
      setLoadingProvider(null);
    }
  }

  async function continueExistingSession() {
    setLoadingProvider("session");
    setError(null);
    try {
      await saveContext();
      window.location.assign("/family/invite/continue");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "초대 상태를 확인하지 못했습니다.");
      setLoadingProvider(null);
    }
  }

  return (
    <main className="min-h-dvh bg-[var(--color-k-surface)] px-5 py-8 flex items-center justify-center">
      <section className="w-full max-w-md rounded-3xl bg-white border border-gray-100 shadow-sm p-6 flex flex-col gap-5">
        <div className="text-center">
          <p className="text-xs font-bold text-[var(--color-k-orange)]">가족 구성원 초대</p>
          <h1 className="text-xl font-black text-gray-900 mt-2">가족에 초대받았어요</h1>
        </div>

        {!initialToken && !submittedCode && (
          <form onSubmit={(event) => { event.preventDefault(); setSubmittedCode(code.trim()); }} className="flex flex-col gap-3">
            <p className="text-sm text-gray-600 text-center">가족에게 받은 8자리 초대 코드를 입력해 주세요.</p>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="K7P4-29DX"
              maxLength={9}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-center font-bold tracking-widest outline-none"
            />
            <button type="submit" disabled={!code.trim()} className="min-h-12 rounded-xl bg-[var(--color-k-navy)] text-white font-bold disabled:opacity-40">
              초대 확인
            </button>
          </form>
        )}

        {state === "loading" && <p className="py-8 text-center text-sm text-gray-500">초대 링크를 확인하고 있어요...</p>}

        {state === "pending" && (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl bg-orange-50 p-4 text-center">
              <p className="font-bold text-gray-900">{inviterName}님의 {familyName}</p>
              <p className="text-sm text-gray-600 mt-1">가족에 참여하려면 본인이 사용하는 계정으로 로그인해 주세요.</p>
            </div>
            <button onClick={() => continueWith("google")} disabled={loadingProvider !== null} className="min-h-12 rounded-xl border border-gray-200 bg-white font-bold text-gray-800 disabled:opacity-50">
              {loadingProvider === "google" ? "Google 연결 중..." : "Google로 계속하기"}
            </button>
            <button onClick={() => continueWith("kakao")} disabled={loadingProvider !== null} className="min-h-12 rounded-xl bg-[#FEE500] font-bold text-[#191919] disabled:opacity-50">
              {loadingProvider === "kakao" ? "Kakao 연결 중..." : "Kakao로 계속하기"}
            </button>
            <button onClick={continueExistingSession} disabled={loadingProvider !== null} className="text-xs font-semibold text-gray-500 underline underline-offset-4">
              이미 로그인되어 있다면 참여 계속하기
            </button>
          </div>
        )}

        {state === "consumed" && (
          <div className="text-center py-4 flex flex-col gap-3">
            <h2 className="font-black text-gray-900">이미 사용된 초대 링크예요</h2>
            <p className="text-sm text-gray-600 mt-2">한 명의 가족 구성원만 사용할 수 있어요. 본인이 사용한 링크라면 로그인 후 참여 상태를 확인할 수 있습니다.</p>
            <button onClick={() => continueWith("google")} disabled={loadingProvider !== null} className="mt-2 min-h-12 w-full rounded-xl border border-gray-200 bg-white font-bold text-gray-800 disabled:opacity-50">Google로 내 참여 확인</button>
            <button onClick={() => continueWith("kakao")} disabled={loadingProvider !== null} className="min-h-12 w-full rounded-xl bg-[#FEE500] font-bold text-[#191919] disabled:opacity-50">Kakao로 내 참여 확인</button>
            <button onClick={continueExistingSession} disabled={loadingProvider !== null} className="text-xs font-semibold text-gray-500 underline underline-offset-4">이미 로그인되어 있다면 바로 확인</button>
          </div>
        )}

        {state === "expired" && <StateMessage title="이 초대 링크는 만료되었습니다" body="가족 오너에게 새로운 초대를 요청해 주세요." />}
        {state === "revoked" && <StateMessage title="취소된 초대 링크입니다" body="가족 오너에게 새로운 초대를 요청해 주세요." />}
        {state === "invalid" && (initialToken || submittedCode) && <StateMessage title="유효하지 않은 초대입니다" body="링크나 초대 코드를 다시 확인해 주세요." />}
        {error && <p role="alert" className="text-sm text-red-600 text-center">{error}</p>}
        <Link href="/login" className="text-center text-xs font-semibold text-gray-500 underline underline-offset-4">로그인 화면으로</Link>
      </section>
    </main>
  );
}

function StateMessage({ title, body }: { title: string; body: string }) {
  return <div className="text-center py-5"><h2 className="font-black text-gray-900">{title}</h2><p className="text-sm text-gray-600 mt-2">{body}</p></div>;
}
