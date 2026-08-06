"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Step = "consent" | "profile" | "family" | "child";
const STEP_INDEX: Record<Step, number> = { consent: 1, profile: 2, family: 3, child: 4 };
const STEP_LABEL: Record<Step, string> = {
  consent: "약관 동의",
  profile: "보호자 정보",
  family: "가족 만들기",
  child: "아이 등록",
};

const GRADES = ["1학년", "2학년", "3학년", "4학년", "5학년", "6학년"];
// 관심사 목록 — app/parent/settings/page.tsx의 기존 INTERESTS와 완전히 동일한 값(요청서
// "새로운 별도 관심사 분류 체계를 중복 생성하지 않는다"). 두 파일이 공통 상수 모듈을
// import하는 구조가 아니라서(기존 관례상 각 화면 파일에 인라인 선언, docs/conventions.md
// "타입정의" 절 참고) 여기도 동일한 관례를 따라 값만 그대로 복사한다.
const INTERESTS = ["공룡", "우주", "동물", "그림", "음악", "스포츠", "요리", "게임", "과학", "책"];

function StepHeader({ step }: { step: Step }) {
  return (
    <div className="w-full max-w-sm mx-auto px-1 mb-4">
      <p className="text-[11px] font-bold text-gray-400">
        {STEP_INDEX[step]} / 4 {STEP_LABEL[step]}
      </p>
      <div className="w-full h-1.5 bg-gray-100 rounded-full mt-1.5 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${(STEP_INDEX[step] / 4) * 100}%`, background: "var(--color-k-navy)" }}
        />
      </div>
    </div>
  );
}

function Shell({ step, children }: { step: Step; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col items-center px-5 py-8" style={{ background: "var(--color-k-surface)" }}>
      <StepHeader step={step} />
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-sm p-6 flex flex-col gap-5">{children}</div>
    </div>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  loading,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full py-3.5 rounded-2xl font-bold text-white text-sm disabled:opacity-50 active:scale-[0.98] transition-transform cursor-pointer"
      style={{ background: "var(--color-k-navy)" }}
    >
      {loading ? "처리 중..." : children}
    </button>
  );
}

function ErrorBanner({ message, onRetry }: { message: string | null; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div className="rounded-xl px-4 py-3 text-xs font-medium text-center flex flex-col items-center gap-2" style={{ background: "#FEF2F2", color: "#DC2626" }}>
      <span>{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-1 text-[11px] font-bold rounded-lg bg-red-100 hover:bg-red-200 text-red-700 transition-colors cursor-pointer"
        >
          다시 시도
        </button>
      )}
    </div>
  );
}

const REQUIRED_CONSENTS = [
  { key: "service_terms", label: "서비스 이용약관 동의" },
  { key: "parent_pii", label: "보호자 개인정보 수집·이용 동의" },
  { key: "child_pii", label: "아이 개인정보 수집·이용 동의" },
  { key: "guardian_u14", label: "만 14세 미만 아이의 법정대리인 동의" },
  { key: "guardian_authority", label: "본인이 해당 아이의 법정대리인이거나 적법한 동의 권한을 보유하고 있음을 확인" },
] as const;
const OPTIONAL_CONSENTS = [
  { key: "marketing", label: "마케팅 정보 수신 동의 (선택)" },
  { key: "event_notice", label: "이벤트·혜택 알림 동의 (선택)" },
] as const;

function ConsentStep({ onNext }: { onNext: () => void }) {
  const [agreements, setAgreements] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allRequired = REQUIRED_CONSENTS.every((c) => agreements[c.key]);

  const toggleAll = (checked: boolean) => {
    const next: Record<string, boolean> = {};
    [...REQUIRED_CONSENTS, ...OPTIONAL_CONSENTS].forEach((c) => (next[c.key] = checked));
    setAgreements(next);
  };

  const submit = async () => {
    if (!allRequired) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/signup/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agreements }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "회원가입 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
      onNext();
    } catch (e: any) {
      setError(e.message || "회원가입 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div>
        <p className="text-base font-bold text-gray-800">약관 및 개인정보 동의</p>
        <p className="text-xs mt-1 text-gray-500">서비스 이용을 위해 아래 내용에 동의해 주세요.</p>
      </div>
      <ErrorBanner message={error} onRetry={submit} />
      <button
        type="button"
        onClick={() => toggleAll(!allRequired)}
        className="text-left text-xs font-bold px-3 py-2.5 rounded-xl bg-gray-50 text-gray-700 cursor-pointer"
      >
        전체 동의하기
      </button>
      <div className="flex flex-col gap-2.5">
        {REQUIRED_CONSENTS.map((c) => (
          <label key={c.key} className="flex items-start gap-2.5 text-xs text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={!!agreements[c.key]}
              onChange={(e) => setAgreements((a) => ({ ...a, [c.key]: e.target.checked }))}
              className="mt-0.5"
            />
            <span>
              <span className="font-bold" style={{ color: "var(--color-k-navy)" }}>
                [필수]
              </span>{" "}
              {c.label}
            </span>
          </label>
        ))}
        <div className="h-px bg-gray-100 my-1" />
        {OPTIONAL_CONSENTS.map((c) => (
          <label key={c.key} className="flex items-start gap-2.5 text-xs text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={!!agreements[c.key]}
              onChange={(e) => setAgreements((a) => ({ ...a, [c.key]: e.target.checked }))}
              className="mt-0.5"
            />
            <span>{c.label}</span>
          </label>
        ))}
      </div>
      <PrimaryButton onClick={submit} disabled={!allRequired} loading={loading}>
        다음 →
      </PrimaryButton>
    </>
  );
}

const RELATIONSHIP_OPTIONS = [
  { value: "mother", label: "어머니" },
  { value: "father", label: "아버지" },
  { value: "legal_guardian", label: "법정대리인" },
  { value: "other_legal_guardian", label: "기타 법정대리인" },
];

function ProfileStep({ onNext }: { onNext: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim() && phone.trim() && relationship && confirmed;

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/signup/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, relationship, legalGuardianConfirmed: confirmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "저장에 실패했습니다.");
      }
      onNext();
    } catch (e: any) {
      setError(e.message || "잠시 후 다시 시도해 주세요. 입력한 내용은 안전하게 보관되어 있습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div>
        <p className="text-base font-bold text-gray-800">보호자 기본정보</p>
        <p className="text-xs mt-1 text-gray-500">서비스 이용에 꼭 필요한 정보만 입력받아요.</p>
      </div>
      <ErrorBanner message={error} onRetry={submit} />
      <input
        type="text"
        placeholder="보호자 이름"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-xl px-4 py-3 text-sm border border-gray-200 outline-none"
      />
      <input
        type="tel"
        placeholder="휴대전화 번호 (예: 010-1234-5678)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className="w-full rounded-xl px-4 py-3 text-sm border border-gray-200 outline-none"
      />
      <select
        value={relationship}
        onChange={(e) => setRelationship(e.target.value)}
        className="w-full rounded-xl px-4 py-3 text-sm border border-gray-200 outline-none bg-white"
      >
        <option value="">아이와의 관계를 선택해주세요</option>
        {RELATIONSHIP_OPTIONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <label className="flex items-start gap-2.5 text-xs text-gray-700 cursor-pointer">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
        <span>본인은 위 아이의 법정대리인이거나 적법한 동의 권한을 보유하고 있음을 확인합니다.</span>
      </label>
      <PrimaryButton onClick={submit} disabled={!canSubmit} loading={loading}>
        다음 →
      </PrimaryButton>
    </>
  );
}

function FamilyStep({ onNext }: { onNext: (familyId: string) => void }) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 가입 중단 후 재개 시, 이미 가족이 만들어져 있는지 먼저 확인한다(요청서 §5.3 재개 요구사항).
  useEffect(() => {
    fetch("/api/families")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const existing = data?.families?.[0]?.family_id;
        if (existing) onNext(existing);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/families", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && data.error?.includes("이미")) {
          // 이미 가족이 있으면(중복 클릭/재시도) 그대로 다음 단계로 — 멱등 처리.
          const listRes = await fetch("/api/families");
          const listData = await listRes.json().catch(() => ({}));
          const existing = listData?.families?.[0]?.family_id;
          if (existing) {
            onNext(existing);
            return;
          }
        }
        throw new Error(data.error || "가족 만들기에 실패했습니다.");
      }
      onNext(data.family.id);
    } catch (e: any) {
      setError(e.message || "잠시 후 다시 시도해 주세요. 입력한 내용은 안전하게 보관되어 있습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div>
        <p className="text-base font-bold text-gray-800">가족 만들기</p>
        <p className="text-xs mt-1 text-gray-500">가족 이름은 나중에 바꿀 수 있어요.</p>
      </div>
      <ErrorBanner message={error} />
      <input
        type="text"
        placeholder="예) 안형진님의 가족"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-2xl px-4 py-3.5 text-sm border border-gray-200 outline-none bg-white text-center"
      />
      <PrimaryButton onClick={submit} disabled={!name.trim()} loading={loading}>
        가족 만들기 →
      </PrimaryButton>
    </>
  );
}

function ChildStep({ familyId, onDone }: { familyId: string; onDone: () => void }) {
  const [familyName, setFamilyName] = useState("");
  const [givenName, setGivenName] = useState("");
  const [gender, setGender] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [grade, setGrade] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);

  const toggleInterest = (v: string) => {
    setInterests((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  };

  const canSubmit =
    familyName.trim() &&
    givenName.trim() &&
    gender &&
    username.trim() &&
    password.length >= 6 &&
    password === passwordConfirm &&
    grade &&
    interests.length > 0 &&
    consent;

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/families/${familyId}/children`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyName: familyName.trim(),
          givenName: givenName.trim(),
          gender,
          username: username.trim(),
          password,
          grade,
          interests,
          guardian_consent: consent,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "아이 등록에 실패했습니다.");
      }
      if (data.autoApproved) {
        setApproved(true);
      } else {
        onDone();
      }
    } catch (e: any) {
      setError(e.message || "잠시 후 다시 시도해 주세요. 입력한 내용은 안전하게 보관되어 있습니다.");
    } finally {
      setLoading(false);
    }
  };

  if (approved) {
    return (
      <div className="flex flex-col items-center text-center gap-4 py-4">
        <p className="text-5xl">🎉</p>
        <p className="text-base font-bold text-gray-800">승인되었습니다</p>
        <p className="text-xs text-gray-500 leading-relaxed">
          아이 등록 내용을 확인했어요. 이제 바로 케이와 대화를 시작할 수 있어요.
        </p>
        <PrimaryButton onClick={onDone}>시작하기 →</PrimaryButton>
      </div>
    );
  }

  return (
    <>
      <div>
        <p className="text-base font-bold text-gray-800">아이 등록</p>
        <p className="text-xs mt-1 text-gray-500">아이 등록 내용을 확인한 뒤 이용할 수 있어요.</p>
      </div>
      <ErrorBanner message={error} />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          placeholder="성"
          value={familyName}
          onChange={(e) => setFamilyName(e.target.value)}
          className="w-full rounded-xl px-3 py-3 text-sm border border-gray-200 outline-none"
        />
        <input
          type="text"
          placeholder="이름"
          value={givenName}
          onChange={(e) => setGivenName(e.target.value)}
          className="w-full rounded-xl px-3 py-3 text-sm border border-gray-200 outline-none"
        />
      </div>
      <div className="flex gap-2">
        {[
          { v: "male", l: "남자" },
          { v: "female", l: "여자" },
        ].map((g) => (
          <button
            key={g.v}
            type="button"
            onClick={() => setGender(g.v)}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold border cursor-pointer ${
              gender === g.v ? "text-white border-transparent" : "text-gray-600 border-gray-200 bg-white"
            }`}
            style={gender === g.v ? { background: "var(--color-k-navy)" } : undefined}
          >
            {g.l}
          </button>
        ))}
      </div>
      <select
        value={grade}
        onChange={(e) => setGrade(e.target.value)}
        className="w-full rounded-xl px-4 py-3 text-sm border border-gray-200 outline-none bg-white"
      >
        <option value="">학년을 선택해주세요</option>
        {GRADES.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-1.5">
        {INTERESTS.map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => toggleInterest(i)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold border cursor-pointer ${
              interests.includes(i) ? "text-white border-transparent" : "text-gray-600 border-gray-200 bg-white"
            }`}
            style={interests.includes(i) ? { background: "var(--color-k-navy)" } : undefined}
          >
            {i}
          </button>
        ))}
      </div>
      <input
        type="text"
        placeholder="아이 로그인 아이디"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        className="w-full rounded-xl px-4 py-3 text-sm border border-gray-200 outline-none"
      />
      <input
        type="password"
        placeholder="비밀번호 (6자 이상)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-xl px-4 py-3 text-sm border border-gray-200 outline-none"
      />
      <input
        type="password"
        placeholder="비밀번호 확인"
        value={passwordConfirm}
        onChange={(e) => setPasswordConfirm(e.target.value)}
        className="w-full rounded-xl px-4 py-3 text-sm border border-gray-200 outline-none"
      />
      <label className="flex items-start gap-2.5 text-xs text-gray-700 cursor-pointer">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
        <span>법정대리인으로서 위 아이의 정보 등록에 동의합니다.</span>
      </label>
      <PrimaryButton onClick={submit} disabled={!canSubmit} loading={loading}>
        아이 등록하고 시작하기 →
      </PrimaryButton>
    </>
  );
}

function SignupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStep = (searchParams.get("step") as Step) ?? "consent";
  const [step, setStep] = useState<Step>(
    ["consent", "profile", "family", "child"].includes(initialStep) ? initialStep : "consent"
  );
  const [familyId, setFamilyId] = useState<string | null>(null);

  const finish = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("k_pwa_intro_seen");
    }
    router.replace("/");
  };

  useEffect(() => {
    const link_id = searchParams.get("link_id");
    if (!link_id || typeof window === "undefined") return;

    let visitor_id = localStorage.getItem("k_visitor_id");
    if (!visitor_id) {
      visitor_id = "v_" + Math.random().toString(36).substring(2) + Date.now().toString(36);
      localStorage.setItem("k_visitor_id", visitor_id);
    }

    const setCookie = (name: string, value: string, days: number) => {
      const d = new Date();
      d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
      document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/;secure;samesite=lax`;
    };
    
    const getCookie = (name: string) => {
      const v = document.cookie.match("(^|;) ?" + name + "=([^;]*)(;|$)");
      return v ? v[2] : null;
    };

    setCookie("k_visitor_id", visitor_id, 30);
    
    if (!getCookie("first_touch_link_id")) {
      setCookie("first_touch_link_id", link_id, 30);
    }
    setCookie("signup_touch_link_id", link_id, 30);

    const landing_path = window.location.pathname + window.location.search;
    const referrer = document.referrer;

    fetch("/api/acquisition/click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link_id, visitor_id, landing_path, referrer })
    }).catch(console.error);
    
    fetch("/api/acquisition/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: "SIGNUP_PAGE_VIEW", visitor_id, attribution_id: visitor_id, link_id })
    }).catch(console.error);

  }, [searchParams]);

  return (
    <Shell step={step}>
      {step === "consent" && <ConsentStep onNext={() => setStep("profile")} />}
      {step === "profile" && <ProfileStep onNext={() => setStep("family")} />}
      {step === "family" && (
        <FamilyStep
          onNext={(id) => {
            setFamilyId(id);
            setStep("child");
          }}
        />
      )}
      {step === "child" &&
        (familyId ? (
          <ChildStep familyId={familyId} onDone={finish} />
        ) : (
          <FamilyStep
            onNext={(id) => {
              setFamilyId(id);
            }}
          />
        ))}
    </Shell>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh flex flex-col items-center justify-center bg-gray-50">
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-k-navy) var(--color-k-navy) transparent transparent" }} />
        </div>
      }
    >
      <SignupContent />
    </Suspense>
  );
}
