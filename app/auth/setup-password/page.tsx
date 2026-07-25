"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";

function SetupPasswordForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"choose" | "change">("choose");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError("비밀번호는 6자 이상이어야 합니다.");
      return;
    }
    if (password !== confirmPassword) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: password })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "비밀번호 변경에 실패했습니다.");
      }

      setSuccess(true);
      setTimeout(() => {
        router.replace("/");
        router.refresh();
      }, 1500);
    } catch (err: any) {
      setError(err.message || "비밀번호 변경에 실패했습니다.");
      setLoading(false);
    }
  };

  const handleSkipPassword = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skip: true })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "비밀번호 유지를 처리하지 못했습니다.");
      }

      setSuccess(true);
      setTimeout(() => {
        router.replace("/");
        router.refresh();
      }, 1500);
    } catch (err: any) {
      setError(err.message || "오류가 발생했습니다.");
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center px-5 py-8 w-full"
      style={{ background: "linear-gradient(160deg, #EEF2FF 0%, #F0FDF4 100%)" }}
    >
      <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-sm border border-gray-100/50" style={{ boxShadow: "var(--shadow-k-card)" }}>
        <div className="text-center mb-6">
          <p className="text-5xl mb-3">🔐</p>
          <h1 className="text-2xl font-bold text-gray-900">비밀번호를 변경하시겠어요?</h1>
          <p className="text-xs text-gray-500 mt-2 leading-relaxed">
            처음 로그인하셨습니다. 보안을 위해 새로운 비밀번호 설정을 권장하지만, 기존 임시 비밀번호를 그대로 유지할 수도 있습니다.
          </p>
        </div>

        {success ? (
          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 text-center text-emerald-800">
            <p className="text-3xl mb-2">🎉</p>
            <p className="text-sm font-bold">비밀번호 설정 완료!</p>
            <p className="text-xs text-emerald-600 mt-1">대시보드로 이동하는 중입니다...</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {error && (
              <div className="rounded-xl px-4 py-3 text-xs font-medium bg-red-50 text-red-600 text-center">
                {error}
              </div>
            )}

            {mode === "choose" ? (
              <div className="flex flex-col gap-3 mt-2">
                <button
                  onClick={() => setMode("change")}
                  disabled={loading}
                  className="w-full py-3.5 rounded-2xl font-bold text-white text-sm bg-gradient-to-r from-emerald-500 to-teal-500 shadow-md active:scale-[0.98] transition-transform cursor-pointer"
                >
                  새 비밀번호 설정하기
                </button>
                <button
                  onClick={handleSkipPassword}
                  disabled={loading}
                  className="w-full py-3.5 rounded-2xl font-semibold text-gray-700 text-sm bg-gray-50 border border-gray-200 active:scale-[0.98] transition-transform cursor-pointer"
                >
                  기존 비밀번호 유지하기
                </button>
              </div>
            ) : (
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">새 비밀번호</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="6자 이상의 비밀번호"
                    required
                    disabled={loading}
                    className="w-full rounded-xl px-4 py-3 text-sm border-2 border-transparent outline-none transition-colors"
                    style={{ background: "#F9FAF6", border: "1px solid rgba(26,107,90,0.12)" }}
                    onFocus={(e) => (e.target.style.borderColor = "var(--color-k-navy)")}
                    onBlur={(e) => (e.target.style.borderColor = "transparent")}
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">비밀번호 확인</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="비밀번호 다시 입력"
                    required
                    disabled={loading}
                    className="w-full rounded-xl px-4 py-3 text-sm border-2 border-transparent outline-none transition-colors"
                    style={{ background: "#F9FAF6", border: "1px solid rgba(26,107,90,0.12)" }}
                    onFocus={(e) => (e.target.style.borderColor = "var(--color-k-navy)")}
                    onBlur={(e) => (e.target.style.borderColor = "transparent")}
                  />
                </div>

                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => { setMode("choose"); setError(null); }}
                    disabled={loading}
                    className="flex-1 py-3.5 rounded-2xl font-semibold text-gray-600 text-sm bg-gray-50 border border-gray-200 cursor-pointer"
                  >
                    이전으로
                  </button>
                  <button
                    type="submit"
                    disabled={loading || password.length < 6 || password !== confirmPassword}
                    className="flex-1 py-3.5 rounded-2xl font-bold text-white text-sm bg-gradient-to-r from-emerald-500 to-teal-500 shadow-md active:scale-[0.98] transition-transform cursor-pointer"
                  >
                    {loading ? "설정 중..." : "변경 완료"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SetupPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-dvh flex flex-col items-center justify-center bg-gray-50">
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-k-navy) var(--color-k-navy) transparent transparent" }} />
      </div>
    }>
      <SetupPasswordForm />
    </Suspense>
  );
}


