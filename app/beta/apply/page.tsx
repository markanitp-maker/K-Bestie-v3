"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const AGE_GROUPS = ["미취학", "1~2학년", "3~4학년", "5~6학년", "중학생 이상"];

export default function BetaApplyPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [ageGroup, setAgeGroup] = useState("");
  const [referralSource, setReferralSource] = useState("");
  const [motivation, setMotivation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/beta/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phone.trim() || undefined,
          age_group: ageGroup || undefined,
          referral_source: referralSource.trim() || undefined,
          motivation: motivation.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "신청에 실패했습니다. 잠시 후 다시 시도해주세요.");
        setSubmitting(false);
        return;
      }

      router.replace("/account/pending");
    } catch {
      setError("네트워크 오류가 발생했습니다.");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: "var(--color-k-surface)" }}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm p-6 flex flex-col gap-5">
        <div className="text-center">
          <h1 className="text-lg font-bold" style={{ color: "var(--color-k-text-primary)" }}>
            베타 서비스 신청
          </h1>
          <p className="text-xs mt-2 leading-relaxed" style={{ color: "var(--color-k-text-secondary)" }}>
            내친구 케이와 함께할 준비가 되셨나요?{"\n"}
            간단한 정보만 알려주시면 빠르게 확인 후 연락드릴게요.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold" style={{ color: "var(--color-k-text-primary)" }}>
              연락처 (선택)
            </label>
            <input
              type="tel"
              placeholder="010-0000-0000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="px-3.5 py-2.5 text-sm rounded-xl outline-none"
              style={{ border: "1px solid var(--color-k-border)", background: "var(--color-k-surface)" }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold" style={{ color: "var(--color-k-text-primary)" }}>
              자녀 연령대 (선택)
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {AGE_GROUPS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setAgeGroup((prev) => (prev === g ? "" : g))}
                  className="py-2 text-[11px] font-bold rounded-xl transition-colors"
                  style={
                    ageGroup === g
                      ? { background: "var(--color-k-navy)", color: "#fff", border: "1px solid transparent" }
                      : { background: "#fff", color: "var(--color-k-text-secondary)", border: "1px solid var(--color-k-border)" }
                  }
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold" style={{ color: "var(--color-k-text-primary)" }}>
              어떻게 알게 되셨나요? (선택)
            </label>
            <input
              type="text"
              placeholder="예) 지인 추천, SNS, 검색 등"
              value={referralSource}
              onChange={(e) => setReferralSource(e.target.value)}
              className="px-3.5 py-2.5 text-sm rounded-xl outline-none"
              style={{ border: "1px solid var(--color-k-border)", background: "var(--color-k-surface)" }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold" style={{ color: "var(--color-k-text-primary)" }}>
              신청 동기 (선택)
            </label>
            <textarea
              placeholder="내친구 케이를 신청하시는 이유를 자유롭게 남겨주세요."
              value={motivation}
              onChange={(e) => setMotivation(e.target.value)}
              rows={3}
              className="px-3.5 py-2.5 text-sm rounded-xl outline-none resize-none"
              style={{ border: "1px solid var(--color-k-border)", background: "var(--color-k-surface)" }}
            />
          </div>

          {error && <p className="text-xs" style={{ color: "var(--color-k-danger)" }}>{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl text-white text-sm font-bold active:scale-95 transition-transform disabled:opacity-50"
            style={{ background: "var(--color-k-navy)" }}
          >
            {submitting ? "신청하는 중..." : "베타 신청하기"}
          </button>
        </form>
      </div>
    </div>
  );
}
