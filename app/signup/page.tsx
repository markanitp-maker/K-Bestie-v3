"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safePostAuthReturnUrl } from "@/lib/auth/safeReturnUrl";
import { ChildStartGuide, type ChildStartGuideChild } from "@/components/parent/ChildStartGuide";
import { LegalDocumentModal } from "@/components/legal/LegalDocumentModal";
import { isLegalDetailAvailable } from "@/lib/legal/environment";
import type { LegalDocumentKey } from "@/lib/legal/types";


type Step = "consent" | "profile" | "family" | "child";
const STEP_INDEX: Record<Step, number> = { consent: 1, profile: 2, family: 3, child: 4 };
const STEP_LABEL: Record<Step, string> = {
  consent: "약관 동의",
  profile: "보호자 정보",
  family: "가족 만들기",
  child: "아이 등록",
};

const GRADES = ["1학년", "2학년", "3학년", "4학년", "5학년", "6학년"];

type ProfileDraft = { name: string; relationship: string };
type ChildDraft = {
  familyName: string;
  givenName: string;
  gender: string;
  username: string;
  password: string;
  passwordConfirm: string;
  grade: string;
  consent: boolean;
};

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

function StepFooterNav({
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
  nextLoading,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
  nextLoading?: boolean;
}) {
  return (
    <div className="w-full grid grid-cols-[35fr_65fr] gap-2 items-stretch">
      <button
        type="button"
        onClick={onBack}
        className="rounded-2xl border border-gray-200 bg-white font-bold text-gray-500 active:scale-[0.98] transition-transform cursor-pointer whitespace-nowrap overflow-hidden"
        style={{ padding: "14px 4px", fontSize: "clamp(12px, 3.4vw, 14px)" }}
      >
        ← 이전
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled || nextLoading}
        className="rounded-2xl font-bold text-white disabled:opacity-50 active:scale-[0.98] transition-transform cursor-pointer whitespace-nowrap overflow-hidden"
        style={{ padding: "14px 6px", fontSize: "clamp(11px, 3.2vw, 14px)", background: "var(--color-k-navy)" }}
      >
        {nextLoading ? "처리 중..." : nextLabel}
      </button>
    </div>
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

function ConsentStep({
  agreements,
  onAgreementsChange,
  onNext,
  onBack,
}: {
  agreements: Record<string, boolean>;
  onAgreementsChange: (agreements: Record<string, boolean>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openDocumentKey, setOpenDocumentKey] = useState<LegalDocumentKey | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("k_saved_agreements");
      if (saved) {
        onAgreementsChange(JSON.parse(saved));
      }
    } catch {}
  }, [onAgreementsChange]);

  const allRequired = REQUIRED_CONSENTS.every((c) => agreements[c.key]);

  const toggleAll = (checked: boolean) => {
    const next: Record<string, boolean> = {};
    [...REQUIRED_CONSENTS, ...OPTIONAL_CONSENTS].forEach((c) => (next[c.key] = checked));
    onAgreementsChange(next);
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
        if (res.status === 401) {
          try {
            sessionStorage.setItem("k_saved_agreements", JSON.stringify(agreements));
          } catch {}
          setError("로그인 세션이 만료되었습니다. 다시 로그인 후 이어 진행합니다.");
          setTimeout(() => {
            window.location.href = "/login?from=/signup";
          }, 1200);
          return;
        }
        throw new Error(data.error || "회원가입 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
      try {
        sessionStorage.removeItem("k_saved_agreements");
      } catch {}
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
          <div key={c.key} className="flex items-start justify-between gap-2">
            <label className="flex min-w-0 flex-1 items-start gap-2.5 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={!!agreements[c.key]}
                onChange={(e) => onAgreementsChange({ ...agreements, [c.key]: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                <span className="font-bold" style={{ color: "var(--color-k-navy)" }}>
                  [필수]
                </span>{" "}
                {c.label}
              </span>{" "}
            </label>
            {isLegalDetailAvailable(c.key) && (
              <button
                type="button"
                onClick={() => setOpenDocumentKey(c.key)}
                className="shrink-0 text-[11px] font-bold text-[var(--color-k-navy)] underline underline-offset-2"
              >
                상세보기 &gt;
              </button>
            )}
          </div>
        ))}
        <div className="h-px bg-gray-100 my-1" />
        {OPTIONAL_CONSENTS.map((c) => (
          <div key={c.key} className="flex items-start justify-between gap-2">
            <label className="flex min-w-0 flex-1 items-start gap-2.5 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={!!agreements[c.key]}
                onChange={(e) => onAgreementsChange({ ...agreements, [c.key]: e.target.checked })}
                className="mt-0.5"
              />
              <span>{c.label}</span>
            </label>
            {isLegalDetailAvailable(c.key) && (
              <button
                type="button"
                onClick={() => setOpenDocumentKey(c.key)}
                className="shrink-0 text-[11px] font-bold text-[var(--color-k-navy)] underline underline-offset-2"
              >
                상세보기 &gt;
              </button>
            )}
          </div>
        ))}
      </div>
      <StepFooterNav onBack={onBack} onNext={submit} nextLabel="다음 →" nextDisabled={!allRequired} nextLoading={loading} />
      {openDocumentKey && (
        <LegalDocumentModal
          documentKey={openDocumentKey}
          open
          onClose={() => setOpenDocumentKey(null)}
        />
      )}
    </>
  );
}

const RELATIONSHIP_OPTIONS = [
  { value: "mother", label: "어머니" },
  { value: "father", label: "아버지" },
  { value: "legal_guardian", label: "법정대리인" },
  { value: "other_legal_guardian", label: "기타 법정대리인" },
];

function ProfileStep({
  draft,
  onDraftChange,
  onNext,
  onBack,
}: {
  draft: ProfileDraft;
  onDraftChange: (draft: ProfileDraft) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = draft.name.trim() && draft.relationship;

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/signup/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name, relationship: draft.relationship }),
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
        value={draft.name}
        onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
        className="w-full rounded-xl px-4 py-3 text-sm border border-gray-200 outline-none"
      />
      <select
        value={draft.relationship}
        onChange={(e) => onDraftChange({ ...draft, relationship: e.target.value })}
        className="w-full rounded-xl px-4 py-3 text-sm border border-gray-200 outline-none bg-white"
      >
        <option value="">아이와의 관계를 선택해주세요</option>
        {RELATIONSHIP_OPTIONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <StepFooterNav onBack={onBack} onNext={submit} nextLabel="다음 →" nextDisabled={!canSubmit} nextLoading={loading} />
    </>
  );
}

function FamilyStep({
  name,
  onNameChange,
  onCreated,
  onBack,
}: {
  name: string;
  onNameChange: (name: string) => void;
  onCreated: (familyId: string) => void;
  onBack: () => void;
}) {
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const submitCreate = async () => {
    if (!name.trim() || submittingRef.current) return;
    submittingRef.current = true;
    setCreateLoading(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/families", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "가족을 만들지 못했습니다. 다시 시도해 주세요.");
      }
      onCreated(data.family.id);
    } catch (e: any) {
      setCreateError(e.message || "잠시 후 다시 시도해 주세요. 입력한 내용은 안전하게 보관되어 있습니다.");
    } finally {
      submittingRef.current = false;
      setCreateLoading(false);
    }
  };

  return (
    <>
      <div>
        <p className="text-base font-bold text-gray-800">가족 만들기</p>
        <p className="text-xs mt-1 text-gray-500">새 가족을 만든 뒤 아이를 등록해 주세요.</p>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 flex flex-col gap-3">
        <div>
          <p className="text-sm font-bold text-gray-800">우리 가족 이름</p>
          <p className="text-[11px] mt-1 text-gray-500">새 가족을 만든 뒤 최초 아이를 등록합니다.</p>
        </div>
        <ErrorBanner message={createError} />
        <input
          type="text"
          placeholder="예) 안형진님의 가족"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className="w-full rounded-xl px-4 py-3 text-sm border border-gray-200 outline-none bg-white text-center"
        />
      </section>
      <StepFooterNav onBack={onBack} onNext={submitCreate} nextLabel="가족 만들기 →" nextDisabled={!name.trim()} nextLoading={createLoading} />
    </>
  );
}

function ChildStep({
  familyId,
  draft,
  onDraftChange,
  onChildApproved,
  onBack,
}: {
  familyId: string;
  draft: ChildDraft;
  onDraftChange: (draft: ChildDraft) => void;
  onChildApproved: (child: ChildStartGuideChild) => void;
  onBack: () => void;
}) {
  const { familyName, givenName, gender, username, password, passwordConfirm, grade, consent } = draft;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [showGuardianDocument, setShowGuardianDocument] = useState(false);
  const submittingRef = useRef(false);

  const canSubmit =
    familyName.trim() &&
    givenName.trim() &&
    gender &&
    username.trim() &&
    password.length >= 6 &&
    password === passwordConfirm &&
    grade &&
    consent;

  const submit = async () => {
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError(null);
    setUsernameError(null);
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
          guardian_consent: consent,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 아이디 중복은 상단 공통 에러 박스가 아니라 아이디 입력창 바로 아래 inline
        // validation으로만 표시한다 — Supabase 원문은 어떤 경우에도 그대로 노출하지 않는다.
        if (data.code === "CHILD_LOGIN_ID_ALREADY_EXISTS") {
          setUsernameError("이미 사용 중인 아이디예요. 다른 아이디를 입력해 주세요.");
          return;
        }
        throw new Error("아이 계정을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
      if (data.autoApproved) {
        onChildApproved({
          id: data.child.id,
          name: `${familyName.trim()}${givenName.trim()}`,
          grade,
        });
      } else {
        throw new Error("아이 계정을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "아이 등록을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

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
          onChange={(e) => onDraftChange({ ...draft, familyName: e.target.value })}
          className="w-full rounded-xl px-3 py-3 text-sm border border-gray-200 outline-none"
        />
        <input
          type="text"
          placeholder="이름"
          value={givenName}
          onChange={(e) => onDraftChange({ ...draft, givenName: e.target.value })}
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
            onClick={() => onDraftChange({ ...draft, gender: g.v })}
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
        onChange={(e) => onDraftChange({ ...draft, grade: e.target.value })}
        className="w-full rounded-xl px-4 py-3 text-sm border border-gray-200 outline-none bg-white"
      >
        <option value="">학년을 선택해주세요</option>
        {GRADES.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
      <p
        className="text-center text-xs sm:text-sm font-medium py-1 whitespace-nowrap"
        style={{ color: "var(--color-k-orange)" }}
      >
        아이들이 접속할 계정을 부모님이 만들어요.
      </p>
      <div>
        <input
          type="text"
          placeholder="아이 로그인 아이디"
          value={username}
          onChange={(e) => {
            onDraftChange({ ...draft, username: e.target.value });
            if (usernameError) setUsernameError(null);
          }}
          className={`w-full rounded-xl px-4 py-3 text-sm border outline-none ${
            usernameError ? "border-red-400" : "border-gray-200"
          }`}
        />
        {usernameError && <p className="text-xs text-red-500 mt-1 px-1">{usernameError}</p>}
      </div>
      <input
        type="password"
        placeholder="비밀번호 (6자 이상)"
        value={password}
        onChange={(e) => onDraftChange({ ...draft, password: e.target.value })}
        className="w-full rounded-xl px-4 py-3 text-sm border border-gray-200 outline-none"
      />
      <input
        type="password"
        placeholder="비밀번호 확인"
        value={passwordConfirm}
        onChange={(e) => onDraftChange({ ...draft, passwordConfirm: e.target.value })}
        className="w-full rounded-xl px-4 py-3 text-sm border border-gray-200 outline-none"
      />
      <div className="flex items-start justify-between gap-2">
        <label className="flex min-w-0 flex-1 items-start gap-2.5 text-xs text-gray-700 cursor-pointer">
          <input type="checkbox" checked={consent} onChange={(e) => onDraftChange({ ...draft, consent: e.target.checked })} className="mt-0.5" />
          <span>법정대리인으로서 위 아이의 정보 등록에 동의합니다.</span>
        </label>
        {isLegalDetailAvailable("guardian_u14") && (
          <button
            type="button"
            onClick={() => setShowGuardianDocument(true)}
            className="shrink-0 text-[11px] font-bold text-[var(--color-k-navy)] underline underline-offset-2"
          >
            상세보기 &gt;
          </button>
        )}
      </div>
      <StepFooterNav onBack={onBack} onNext={submit} nextLabel="아이 등록하고 시작하기 →" nextDisabled={!canSubmit} nextLoading={loading} />
      <LegalDocumentModal
        documentKey="guardian_u14"
        open={showGuardianDocument}
        onClose={() => setShowGuardianDocument(false)}
      />
    </>
  );
}

function SignupContent() {
  const router = useRouter();
  const rawSearchParams = useSearchParams();
  const searchParams = rawSearchParams ?? new URLSearchParams();
  const [authChecking, setAuthChecking] = useState(true);
  const returnUrl = safePostAuthReturnUrl(searchParams.get("returnUrl"));

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        const query = returnUrl === "/" ? "" : `?returnUrl=${encodeURIComponent(returnUrl)}`;
        window.location.replace(`/login${query}`);
        return;
      }
      setAuthChecking(false);
    });
  }, [returnUrl]);

  const initialStep = (searchParams.get("step") as Step) ?? "consent";
  const familyInviteRequested = searchParams.get("familyInvite") === "1";
  const [step, setStep] = useState<Step>(
    ["consent", "profile", "family", "child"].includes(initialStep) ? initialStep : "consent"
  );
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [loadingFamily, setLoadingFamily] = useState(true);
  const [agreements, setAgreements] = useState<Record<string, boolean>>({});
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>({ name: "", relationship: "" });
  const [familyName, setFamilyName] = useState("");
  const [childDraft, setChildDraft] = useState<ChildDraft>({
    familyName: "",
    givenName: "",
    gender: "",
    username: "",
    password: "",
    passwordConfirm: "",
    grade: "",
    consent: false,
  });
  const [approvedChild, setApprovedChild] = useState<ChildStartGuideChild | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const handoffNavigatingRef = useRef(false);

  const navigateStep = useCallback((nextStep: Step) => {
    setStep(nextStep);
    const params = new URLSearchParams(searchParams.toString());
    params.set("step", nextStep);
    router.replace(`/signup?${params.toString()}`);
  }, [router, searchParams]);

  const continueInviteIfPending = useCallback(async (): Promise<boolean> => {
    if (!familyInviteRequested) return false;
    const response = await fetch("/api/family-invites/session", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.state === "pending") {
      window.location.replace("/family/invite/continue");
      return true;
    }
    return false;
  }, [familyInviteRequested]);


  const finish = useCallback(() => {
    // 필수 가입 단계가 끝난 뒤에만 허브의 PWA 설치 제안 게이트를 통과한다.
    // returnUrl은 허브가 설치 제안 후 복원하므로 기존 초대·목적지 정책은 바꾸지 않는다.
    const destination = returnUrl === "/" ? "/" : `/?returnUrl=${encodeURIComponent(returnUrl)}`;
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("k_pwa_intro_seen");
      window.location.replace(destination);
    } else {
      router.replace(destination);
    }
  }, [returnUrl, router]);

  const handleParentHomeFromHandoff = useCallback(async () => {
    if (handoffNavigatingRef.current) return;
    handoffNavigatingRef.current = true;
    setHandoffError(null);
    try {
      const res = await fetch("/api/auth/membership-status", { cache: "no-store" });
      if (res.ok) {
        const status = await res.json();
        if (status.state === "ACTIVE_PARENT") {
          finish();
          return;
        }
      }
      setHandoffError("가입 상태 확인 중입니다. 잠시 후 다시 시작하기를 눌러주세요.");
    } catch {
      setHandoffError("상태 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      handoffNavigatingRef.current = false;
    }
  }, [finish]);

  // 서버의 단일 멤버십 판정으로 중단된 가입 단계를 복원한다. 기존 가족에 role=parent로
  // 합류한 보호자는 ACTIVE_PARENT이므로 child 단계로 보내지 않고 바로 보호자 홈으로 간다.
  useEffect(() => {
    fetch("/api/auth/membership-status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (status) => {
        if (!status) return;
        if (status.state === "ACTIVE_PARENT") {
          finish();
          return;
        }
        if (status.state === "AUTHENTICATED_INCOMPLETE") {
          if (status.familyId) setFamilyId(status.familyId);
          if (
            familyInviteRequested
            && (status.onboardingStep === "family" || status.onboardingStep === "child")
            && await continueInviteIfPending()
          ) {
            return;
          }
          if (["consent", "profile", "family", "child"].includes(status.onboardingStep)) {
            setStep(status.onboardingStep as Step);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        setLoadingFamily(false);
      });
  }, [continueInviteIfPending, familyInviteRequested, finish]);

  useEffect(() => {
    if (!loadingFamily && step === "child" && !familyId) navigateStep("family");
  }, [familyId, loadingFamily, navigateStep, step]);

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


  if (authChecking) {

    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-gray-50">
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-k-navy) var(--color-k-navy) transparent transparent" }} />
      </div>
    );
  }

  if (step === "child" && approvedChild) {
    return (
      <main
        className="flex min-h-dvh justify-center overflow-x-hidden px-4 py-5 sm:items-center sm:px-6 sm:py-8"
        style={{ background: "linear-gradient(155deg, #F3F7FF 0%, #F7F4FF 52%, #FFF7F0 100%)" }}
      >
        <div className="w-full max-w-[440px] self-start rounded-[30px] border border-white/80 bg-white/90 px-5 py-5 shadow-[0_22px_60px_rgba(16,49,91,0.12)] backdrop-blur-sm sm:self-auto sm:px-7 sm:py-6">
          <ChildStartGuide
            children={[approvedChild]}
            initialChildId={approvedChild.id}
            onParentHome={handleParentHomeFromHandoff}
            showCompletionPill
          />
          {handoffError && (
            <div className="mt-3">
              <ErrorBanner message={handoffError} />
            </div>
          )}
        </div>
      </main>
    );
  }

  return (

    <Shell step={step}>
      {step === "consent" && (
        <ConsentStep
          agreements={agreements}
          onAgreementsChange={setAgreements}
          onNext={() => navigateStep("profile")}
          onBack={() => router.replace("/login")}
        />
      )}
      {step === "profile" && (
        <ProfileStep
          draft={profileDraft}
          onDraftChange={setProfileDraft}
          onNext={() => {
            void continueInviteIfPending().then((continued) => {
              if (!continued) navigateStep("family");
            });
          }}
          onBack={() => navigateStep("consent")}
        />
      )}
      {step === "family" && (
        <FamilyStep
          name={familyName}
          onNameChange={setFamilyName}
          onCreated={(id) => {
            setFamilyId(id);
            navigateStep("child");
          }}
          onBack={() => navigateStep("profile")}
        />
      )}
      {step === "child" &&
        (familyId ? (
          <ChildStep
            familyId={familyId}
            draft={childDraft}
            onDraftChange={setChildDraft}
            onChildApproved={setApprovedChild}
            onBack={() => navigateStep("family")}
          />
        ) : loadingFamily ? (
          <div className="flex flex-col items-center justify-center py-10">
            <div
              className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "var(--color-k-navy) var(--color-k-navy) transparent transparent" }}
            />
            <p className="text-xs text-gray-400 mt-3">가족 정보를 확인하는 중...</p>
          </div>
        ) : null)}
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
