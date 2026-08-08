"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safePostAuthReturnUrl } from "@/lib/auth/safeReturnUrl";
import { ChildStartGuide } from "@/components/parent/ChildStartGuide";


type Step = "consent" | "profile" | "family" | "child";
const STEP_INDEX: Record<Step, number> = { consent: 1, profile: 2, family: 3, child: 4 };
const STEP_LABEL: Record<Step, string> = {
  consent: "약관 동의",
  profile: "보호자 정보",
  family: "가족 선택",
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

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("k_saved_agreements");
      if (saved) {
        setAgreements(JSON.parse(saved));
      }
    } catch {}
  }, []);

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
  const [relationship, setRelationship] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim() && relationship && confirmed;

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/signup/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, relationship, legalGuardianConfirmed: confirmed }),
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

type PendingFamilyInvite = {
  id: string;
  familyName: string;
  inviterName: string;
};

function FamilyStep({
  onCreated,
  onJoined,
}: {
  onCreated: (familyId: string) => void;
  onJoined: () => void;
}) {
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(true);
  const [createError, setCreateError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [pendingInvite, setPendingInvite] = useState<PendingFamilyInvite | null>(null);
  const [joinRequestSent, setJoinRequestSent] = useState(false);

  const loadPendingInvite = async () => {
    setInviteLoading(true);
    try {
      const res = await fetch("/api/families/pending-invite", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "초대 정보를 확인하지 못했습니다.");
      setPendingInvite(data.invite ?? null);
      return data.invite as PendingFamilyInvite | null;
    } catch (e: any) {
      setJoinError(e.message || "초대 정보를 확인하지 못했습니다.");
      return null;
    } finally {
      setInviteLoading(false);
    }
  };

  useEffect(() => {
    void loadPendingInvite();
    // 최초 진입 시 한 번만 기존 초대를 확인한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verifyJoinedMembership = async () => {
    const res = await fetch("/api/auth/membership-status", { cache: "no-store" });
    const status = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(status.error || "가족 참여 상태를 확인하지 못했습니다.");
    if (status.state === "ACTIVE_PARENT" && status.role === "parent") {
      onJoined();
      return true;
    }
    return false;
  };

  const submitCreate = async () => {
    if (!name.trim()) return;
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
      setCreateLoading(false);
    }
  };

  const acceptInvite = async () => {
    if (!pendingInvite) return;
    setJoinLoading(true);
    setJoinError(null);
    try {
      const res = await fetch(`/api/families/pending-invite/${pendingInvite.id}/accept`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "가족 초대를 수락하지 못했습니다.");
      if (!(await verifyJoinedMembership())) {
        throw new Error("가족 연결은 완료됐지만 가입 상태 확인이 지연되고 있습니다. 다시 확인해 주세요.");
      }
    } catch (e: any) {
      setJoinError(e.message || "가족 초대를 수락하지 못했습니다.");
    } finally {
      setJoinLoading(false);
    }
  };

  const requestToJoin = async () => {
    if (!ownerEmail.trim()) return;
    setJoinLoading(true);
    setJoinError(null);
    try {
      const res = await fetch("/api/family-join-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_email: ownerEmail.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "가족 참여 요청을 보내지 못했습니다.");
      setJoinRequestSent(true);
    } catch (e: any) {
      setJoinError(e.message || "가족 참여 요청을 보내지 못했습니다.");
    } finally {
      setJoinLoading(false);
    }
  };

  const checkJoinStatus = async () => {
    setJoinLoading(true);
    setJoinError(null);
    try {
      if (await verifyJoinedMembership()) return;
      const invite = await loadPendingInvite();
      if (!invite) {
        setJoinError("아직 가족 대표의 승인을 기다리고 있어요.");
      }
    } catch (e: any) {
      setJoinError(e.message || "가족 참여 상태를 확인하지 못했습니다.");
    } finally {
      setJoinLoading(false);
    }
  };

  return (
    <>
      <div>
        <p className="text-base font-bold text-gray-800">가족 시작 방법을 선택해 주세요</p>
        <p className="text-xs mt-1 text-gray-500">새 가족을 만들거나 기존 가족의 보호자로 참여할 수 있어요.</p>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 flex flex-col gap-3">
        <div>
          <p className="text-sm font-bold text-gray-800">1. 가족 만들기</p>
          <p className="text-[11px] mt-1 text-gray-500">새 가족을 만든 뒤 최초 아이를 등록합니다.</p>
        </div>
        <ErrorBanner message={createError} />
        <input
          type="text"
          placeholder="예) 안형진님의 가족"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-xl px-4 py-3 text-sm border border-gray-200 outline-none bg-white text-center"
        />
        <PrimaryButton onClick={submitCreate} disabled={!name.trim()} loading={createLoading}>
          가족 만들기 →
        </PrimaryButton>
      </section>

      <section className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4 flex flex-col gap-3">
        <div>
          <p className="text-sm font-bold text-gray-800">2. 가족 구성원으로 참여하기</p>
          <p className="text-[11px] mt-1 text-gray-500">기존 가족의 아이와 리포트를 함께 보며, 새 아이를 등록하지 않습니다.</p>
        </div>
        <ErrorBanner message={joinError} onRetry={checkJoinStatus} />

        {inviteLoading ? (
          <p className="py-4 text-center text-xs text-gray-500">도착한 가족 초대를 확인하고 있어요...</p>
        ) : pendingInvite ? (
          <div className="rounded-xl border border-sky-100 bg-white p-3">
            <p className="text-xs font-bold text-gray-800">{pendingInvite.familyName} 가족에서 초대가 왔어요</p>
            <p className="text-[11px] text-gray-500 mt-1">{pendingInvite.inviterName}님이 보호자로 초대했습니다.</p>
            <button
              type="button"
              onClick={acceptInvite}
              disabled={joinLoading}
              className="w-full mt-3 py-3 rounded-xl font-bold text-white text-sm disabled:opacity-50 active:scale-[0.98] transition-transform cursor-pointer"
              style={{ background: "var(--color-k-navy)" }}
            >
              {joinLoading ? "참여 처리 중..." : "초대 수락하고 참여하기 →"}
            </button>
          </div>
        ) : joinRequestSent ? (
          <div className="rounded-xl border border-sky-100 bg-white p-3 text-center">
            <p className="text-xs font-bold text-gray-800">가족 대표에게 참여 요청을 보냈어요</p>
            <p className="text-[11px] text-gray-500 mt-1">대표 보호자가 승인하면 아이 등록 없이 바로 시작할 수 있어요.</p>
            <button
              type="button"
              onClick={checkJoinStatus}
              disabled={joinLoading}
              className="w-full mt-3 py-3 rounded-xl font-bold text-sm bg-white border border-gray-200 text-gray-700 disabled:opacity-50 cursor-pointer"
            >
              {joinLoading ? "확인 중..." : "승인 여부 확인"}
            </button>
          </div>
        ) : (
          <>
            <input
              type="email"
              placeholder="가족 대표의 로그인 이메일"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              className="w-full rounded-xl px-4 py-3 text-sm border border-gray-200 outline-none bg-white text-center"
            />
            <button
              type="button"
              onClick={requestToJoin}
              disabled={joinLoading || !ownerEmail.trim()}
              className="w-full py-3 rounded-xl font-bold text-sm bg-white border border-gray-200 text-gray-700 disabled:opacity-50 active:scale-[0.98] transition-transform cursor-pointer"
            >
              {joinLoading ? "요청 보내는 중..." : "가족 참여 요청 보내기"}
            </button>
            <button
              type="button"
              onClick={loadPendingInvite}
              disabled={joinLoading}
              className="text-[11px] font-semibold text-gray-500 underline underline-offset-2 cursor-pointer disabled:opacity-50"
            >
              이미 초대받았다면 다시 확인
            </button>
          </>
        )}
      </section>
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
  const [approvedChild, setApprovedChild] = useState<{ id: string; name: string; grade: string } | null>(null);

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
        throw new Error(data.error || "아이 등록을 완료하지 못했습니다. 이미 사용 중인 아이디인지 확인해 주세요.");
      }
      if (data.autoApproved) {
        setApprovedChild({
          id: data.child.id,
          name: `${familyName.trim()}${givenName.trim()}`,
          grade,
        });
      } else {
        throw new Error(data.error || "아이 계정 생성에 실패했습니다. 이미 존재하거나 다른 아이디로 시도해 주세요.");
      }
    } catch (e: any) {
      setError(e.message || "아이 등록을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  };

  const [confirmingStatus, setConfirmingStatus] = useState(false);

  const handleStart = async () => {
    setConfirmingStatus(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/membership-status", { cache: "no-store" });
      if (res.ok) {
        const status = await res.json();
        if (status.state === "ACTIVE_PARENT") {
          onDone();
          return;
        }
      }
      setError("가입 상태 확인 중입니다. 잠시 후 다시 시작하기를 눌러주세요.");
    } catch {
      setError("상태 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setConfirmingStatus(false);
    }
  };

  if (approvedChild) {
    return (
      <ChildStartGuide
        children={[approvedChild]}
        initialChildId={approvedChild.id}
        onParentHome={handleStart}
      />
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
      <p
        className="text-center text-xs sm:text-sm font-medium py-1 whitespace-nowrap"
        style={{ color: "var(--color-k-orange)" }}
      >
        아이들이 접속할 계정을 부모님이 만들어요.
      </p>
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
  const [step, setStep] = useState<Step>(
    ["consent", "profile", "family", "child"].includes(initialStep) ? initialStep : "consent"
  );
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [loadingFamily, setLoadingFamily] = useState(true);
  const [showJoinedHandoff, setShowJoinedHandoff] = useState(false);


  const finish = useCallback(() => {
    const destination = returnUrl === "/" ? "/parent/home" : returnUrl;
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("k_pwa_intro_seen");
      window.location.replace(destination);
    } else {
      router.replace(destination);
    }
  }, [returnUrl, router]);

  // 서버의 단일 멤버십 판정으로 중단된 가입 단계를 복원한다. 기존 가족에 role=parent로
  // 합류한 보호자는 ACTIVE_PARENT이므로 child 단계로 보내지 않고 바로 보호자 홈으로 간다.
  useEffect(() => {
    fetch("/api/auth/membership-status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((status) => {
        if (!status) return;
        if (status.state === "ACTIVE_PARENT") {
          finish();
          return;
        }
        if (status.state === "AUTHENTICATED_INCOMPLETE") {
          if (status.familyId) setFamilyId(status.familyId);
          if (["consent", "profile", "family", "child"].includes(status.onboardingStep)) {
            setStep(status.onboardingStep as Step);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        setLoadingFamily(false);
      });
  }, [finish]);

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

  if (showJoinedHandoff) {
    return (
      <div className="min-h-dvh bg-[var(--color-k-surface)] px-5 py-8">
        <div className="mx-auto w-full max-w-md rounded-3xl bg-white p-6 shadow-sm">
          <ChildStartGuide onParentHome={finish} />
        </div>
      </div>
    );
  }

  return (

    <Shell step={step}>
      {step === "consent" && <ConsentStep onNext={() => setStep("profile")} />}
      {step === "profile" && <ProfileStep onNext={() => setStep("family")} />}
      {step === "family" && (
        <FamilyStep
          onCreated={(id) => {
            setFamilyId(id);
            setStep("child");
          }}
          onJoined={() => setShowJoinedHandoff(true)}
        />
      )}
      {step === "child" &&
        (familyId ? (
          <ChildStep familyId={familyId} onDone={finish} />
        ) : loadingFamily ? (
          <div className="flex flex-col items-center justify-center py-10">
            <div
              className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "var(--color-k-navy) var(--color-k-navy) transparent transparent" }}
            />
            <p className="text-xs text-gray-400 mt-3">가족 정보를 확인하는 중...</p>
          </div>
        ) : (
          <FamilyStep
            onCreated={(id) => {
              setFamilyId(id);
              setStep("child");
            }}
            onJoined={() => setShowJoinedHandoff(true)}
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
