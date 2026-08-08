"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/hooks/useStore";
import { createClient } from "@/lib/supabase/client";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { useDemoView } from "@/app/demo/components/DemoViewContext";
import { RealParentNav } from "@/components/RealParentNav";
import { ParentHeader } from "@/components/ParentHeader";
import { SkeletonBox } from "@/components/Skeleton";
import {
  setNotifSetting,
  clearStore,
  updateChild,
  removeChild,
  type StoreChild,
} from "@/lib/store";
import { getEffectiveRetention, type Tier } from "@/lib/plan/retention";
import { calculateFinalDeletionDate, purchaseExtension } from "@/lib/plan/insightExtension";
import { CONSENT_DOCUMENT_TEXT } from "@/lib/plan/consentDocument";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { revokeCurrentPushInstallation, usePushSubscription } from "@/lib/notifications/usePushSubscription";
import KChatbotWidget from "@/components/KChatbotWidget";
import { ChildStartGuideModal, type ChildStartGuideChild } from "@/components/parent/ChildStartGuide";

function formatRetentionLabel(tier: Tier): string {
  const retention = getEffectiveRetention(tier, 0);
  const months = retention.months;
  return months % 12 === 0 ? `${months / 12}년` : `${months}개월`;
}

const GRADES = ["1학년", "2학년", "3학년", "4학년", "5학년", "6학년", "중학교 1학년"];
const INTERESTS = ["공룡", "우주", "동물", "그림", "음악", "스포츠", "요리", "게임", "과학", "책"];
// plans 테이블(tier 1/2/3) 기준 사용자용 이름 — 내부 tier 숫자는 화면에 노출하지 않는다.
// TODO: 정식 오픈 시 결제 연동으로 전환 필요 — 자세한 건 FUTURE_TODO.md 참고.
const CARE_PLANS: { tier: number; label: string }[] = [
  { tier: 1, label: "케어 스타트" },
  { tier: 2, label: "케어 인사이트" },
  { tier: 3, label: "케어 프리미엄" },
];

interface Question {
  id: string;
  question_text: string;
  status: "대기중" | "전달됨" | "중지됨";
  delivered_count: number;
}

export default function ParentSettingsPage() {
  const router = useRouter();
  const store = useStore();
  const { reportAlert, weeklySummary } = store.notifSettings;
  const { view: demoView } = useDemoView();
  const { installPrompt, isIOS, isStandalone, handleInstall } = useInstallPrompt();
  const { requestAndSubscribe, setEnabled } = usePushSubscription();
  const [pushSaving, setPushSaving] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const handleReportAlertToggle = async (checked: boolean) => {
    setNotifSetting("reportAlert", checked);
    setPushError(null);
    setPushSaving(true);
    try {
      if (checked) {
        const result = await requestAndSubscribe();
        if (result !== "granted") {
          setPushError(
            result === "unsupported"
              ? "이 브라우저에서는 알림을 지원하지 않아요."
              : "알림 권한이 허용되지 않아 알림을 받을 수 없어요. 브라우저 설정에서 알림 권한을 허용해 주세요."
          );
          setNotifSetting("reportAlert", false);
          setPushSaving(false);
          return;
        }
      } else {
        await setEnabled(false);
      }
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("parents").update({ report_push_enabled: checked }).eq("id", user.id);
      }
    } finally {
      setPushSaving(false);
    }
  };

  const [mounted, setMounted] = useState(false);
  const [windowWidth, setWindowWidth] = useState<number>(1200);

  useEffect(() => {
    const update = () => setWindowWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const isMobileCard = demoView === "mobile" || windowWidth < 768;
  const [questions, setQuestions] = useState<Question[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // 구성원 관리 상태
  const [familyMembers, setFamilyMembers] = useState<any[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loginGuideChild, setLoginGuideChild] = useState<ChildStartGuideChild | null>(null);

  // 구성원 추가 폼 상태
  const [inviteEmail, setInviteEmail] = useState("");
  const [addFamilyName, setAddFamilyName] = useState("");
  const [addGivenName, setAddGivenName] = useState("");
  const [addUsername, setAddUsername] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addChildGender, setAddChildGender] = useState<string>("");
  const [addChildGrade, setAddChildGrade] = useState("1학년");
  const [addChildInterests, setAddChildInterests] = useState<string[]>([]);
  const [addChildConsent, setAddChildConsent] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);
  const [addSuccessMessage, setAddSuccessMessage] = useState<string | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showBetaApprovedModal, setShowBetaApprovedModal] = useState(false);

  // 053: 아이 승인 요청(pending/creation_failed/rejected) 상태 - 조회 전용(승인/재시도는 관리자 화면)
  const [approvalRequests, setApprovalRequests] = useState<any[]>([]);

  // 비밀번호 초기화 상태
  const [resettingMember, setResettingMember] = useState<any | null>(null);
  const [newResetPassword, setNewResetPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);

  // 수정 상태
  const [editChild, setEditChild] = useState<StoreChild | null>(null);
  const editChildIdRef = useRef<string | null>(null);

  useEffect(() => {
    editChildIdRef.current = editChild?.id ?? null;
  }, [editChild]);

  const [editFamilyName, setEditFamilyName] = useState("");
  const [editGivenName, setEditGivenName] = useState("");
  const [editGrade, setEditGrade] = useState("");
  const [editInterests, setEditInterests] = useState<string[]>([]);
  const [editOriginalTier, setEditOriginalTier] = useState<number>(1);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 027: 자녀 프로필 저장 검증/피드백 상태
  const [saveFieldErrors, setSaveFieldErrors] = useState<{ familyName?: string; givenName?: string; grade?: string; interests?: string }>({});
  const [saveErrorSummary, setSaveErrorSummary] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [saveServerError, setSaveServerError] = useState<string | null>(null);
  const familyNameInputRef = useRef<HTMLInputElement | null>(null);
  const givenNameInputRef = useRef<HTMLInputElement | null>(null);
  const gradeSectionRef = useRef<HTMLDivElement | null>(null);
  const interestsSectionRef = useRef<HTMLDivElement | null>(null);
  // 모달을 열 때의 원본 프로필 값 스냅샷 — 요금제 변경요청 직전 "수정 중인 값이 있는지" 판정용(§10)
  const originalProfileRef = useRef<{ familyName: string; givenName: string; grade: string; interests: string[] } | null>(null);

  // 027: 요금제 변경 요청(승인 대기) 상태 — 즉시 tier를 바꾸지 않고 요청만 생성한다.
  const [planRequest, setPlanRequest] = useState<{
    id: string;
    current_plan_snapshot: number;
    requested_tier: number;
    status: "pending" | "approved" | "rejected" | "cancelled";
    requested_at: string;
    reviewed_at: string | null;
    review_note: string | null;
  } | null>(null);
  const [pendingPlanTier, setPendingPlanTier] = useState<number | null>(null);
  const [showPlanConfirm, setShowPlanConfirm] = useState(false);
  const [showUnsavedGate, setShowUnsavedGate] = useState(false);
  const [planRequestSubmitting, setPlanRequestSubmitting] = useState(false);
  const [planRequestError, setPlanRequestError] = useState<string | null>(null);
  const [showPlanAccepted, setShowPlanAccepted] = useState<{ requestedTier: number; currentTier: number } | null>(null);
  const [cancellingPlanRequest, setCancellingPlanRequest] = useState(false);

  // Care Insight 연장 관련 상태
  const [extensionYears, setExtensionYears] = useState<number>(0);
  const [finalDeletionDate, setFinalDeletionDate] = useState<Date | null>(null);
  const [showExtensionModal, setShowExtensionModal] = useState(false);
  const [isPurchasingExtension, setIsPurchasingExtension] = useState(false);

  // 법정대리인 동의 철회 상태 — 철회 확인 전에는 API를 호출하지 않는다(되돌릴 방법이 없는
  // 조작이라 확인 모달을 반드시 거치게 함). withdrawTarget에 아이 정보를 담아 모달에 표시.
  const [withdrawTarget, setWithdrawTarget] = useState<{ childId: string; displayName: string } | null>(null);
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  // 아이 삭제 상태
  const [deleteChildTarget, setDeleteChildTarget] = useState<{ childId: string; displayName: string } | null>(null);
  const [deleteChildConfirmName, setDeleteChildConfirmName] = useState("");
  const [deleteChildLoading, setDeleteChildLoading] = useState(false);
  const [deleteChildError, setDeleteChildError] = useState<string | null>(null);

  // 자녀 계정 관리 관련 상태
  const [checkingAccount, setCheckingAccount] = useState(false);
  const [accountUsername, setAccountUsername] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [showResetArea, setShowResetArea] = useState(false);
  const [resetPasswordMode, setResetPasswordMode] = useState<"auto" | "direct">("auto");
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [confirmPasswordInput, setConfirmPasswordInput] = useState("");
  const [resettingChildPassword, setResettingChildPassword] = useState(false);
  const [childResetResult, setChildResetResult] = useState<{ username: string; password?: string } | null>(null);
  const [copiedChildCreds, setCopiedChildCreds] = useState(false);

  // 모달이 닫히면 계정 관리 상태 초기화
  useEffect(() => {
    if (!editChild) {
      setAccountUsername(null);
      setAccountError(null);
      setShowResetArea(false);
      setResetPasswordMode("auto");
      setNewPasswordInput("");
      setConfirmPasswordInput("");
      setChildResetResult(null);
      setCopiedChildCreds(false);
      setCheckingAccount(false);
      setResettingChildPassword(false);
      originalProfileRef.current = null;
      setSaveFieldErrors({});
      setSaveErrorSummary(null);
      setSaveServerError(null);
      setSaveState("idle");
      setPlanRequest(null);
      setPlanRequestError(null);
      setPendingPlanTier(null);
      setShowPlanConfirm(false);
      setShowUnsavedGate(false);
    }
  }, [editChild]);

  // 가입 신청 목록 및 로딩 상태
  const [joinRequests, setJoinRequests] = useState<any[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [sentInvites, setSentInvites] = useState<any[]>([]);
  const [loadingSentInvites, setLoadingSentInvites] = useState(true);

  // 닉네임 수정 상태
  const [nicknameInput, setNicknameInput] = useState("");
  const [savingNickname, setSavingNickname] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [nicknameSuccess, setNicknameSuccess] = useState(false);

  // 아코디언 토글 상태 (기본은 닫힘)
  const [activeMenu, setActiveMenu] = useState<"add_child" | "edit_child" | "family_members" | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("open") === "add-child") {
      setActiveMenu("add_child");
      requestAnimationFrame(() => {
        document.getElementById("add-child-section")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
  }, []);

  // 탈퇴 모달 상태
  const [withdrawalPanelOpen, setWithdrawalPanelOpen] = useState(false);
  const [withdrawalStep, setWithdrawalStep] = useState<1 | 2>(1);
  const [withdrawalAgreed, setWithdrawalAgreed] = useState(false);
  const [withdrawalSuccessor, setWithdrawalSuccessor] = useState<string>("");
  const [withdrawalPassword, setWithdrawalPassword] = useState("");
  const [withdrawalReason, setWithdrawalReason] = useState("");
  const [withdrawalLoading, setWithdrawalLoading] = useState(false);
  const [withdrawalError, setWithdrawalError] = useState<string | null>(null);
  const [userProvider, setUserProvider] = useState<string>("email");
  const [withdrawalLastGuardianAgreed, setWithdrawalLastGuardianAgreed] = useState(false);

  // Care Insight 연장팩 데이터 로드
  useEffect(() => {
    if (store.activeFamilyId) {
      calculateFinalDeletionDate(store.activeFamilyId).then(date => {
        setFinalDeletionDate(date);
      }).catch(console.error);

      const fetchExtensions = async () => {
        const supabase = createClient();
        const { data, error } = await supabase.from("insight_retention_extensions")
          .select("extension_years_purchased")
          .eq("family_id", store.activeFamilyId)
          .limit(1);
        
        if (error) {
          console.error(error);
          setExtensionYears(0);
        } else if (data && data.length > 0) {
          setExtensionYears(data[0].extension_years_purchased);
        } else {
          setExtensionYears(0);
        }
      };
      
      fetchExtensions();
    }
  }, [store.activeFamilyId, showExtensionModal]);

  // 로그인 이메일 및 구성원 정보 로드
  useEffect(() => {
    setMounted(true);
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setUserEmail(data.user.email);
      if (data.user?.app_metadata?.provider) setUserProvider(data.user.app_metadata.provider);
    }).catch(() => {});

    fetch("/api/parents/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.parent?.name) {
          setNicknameInput(data.parent.name);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const id = localStorage.getItem("k_child_id");
    if (!id) return;

    fetch(`/api/parent/questions?childId=${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((qData) => setQuestions(qData?.questions ?? []))
      .catch(() => {});
  }, []);

  const loadFamilyMembers = async () => {
    if (!store.activeFamilyId) {
      setLoadingMembers(false);
      return;
    }

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const famRes = await fetch(`/api/families/${store.activeFamilyId}`);
      if (!famRes.ok) throw new Error("가족 정보 조회 실패");
      const { family } = await famRes.json();

      const myMember = family.family_members.find((m: any) => m.user_id === user.id);
      const owner = myMember?.role === "owner_parent";
      setIsOwner(owner);

      const { data: accounts, error: accErr } = await supabase
        .from("member_accounts")
        .select("id, username, display_name, role, must_change_password")
        .eq("family_id", store.activeFamilyId);

      if (accErr) throw accErr;

      const merged = family.family_members.map((m: any) => {
        const acc = accounts?.find((a: any) => a.id === m.user_id);
        const childProf = m.role === "child"
          ? family.child_profiles?.find((c: any) => c.member_id === m.id)
          : null;
        
        let dispName = "";
        if (m.role === "child") {
          dispName = childProf?.name || "";
        } else {
          dispName = acc ? (acc.display_name || "") : (m.parent_name || "");
        }

        return {
          memberId: m.id,
          userId: m.user_id,
          role: m.role,
          username: acc?.username || "",
          displayName: dispName || "구성원",
          mustChangePassword: acc?.must_change_password ?? false,
          isMe: m.user_id === user.id,
          childId: childProf?.id || "",
          familyName: childProf?.family_name || "",
          givenName: childProf?.given_name || "",
          grade: childProf?.grade || "",
          interests: childProf?.interests || [],
          tier: childProf?.tier ?? 1,
          guardianConsentWithdrawnAt: childProf?.guardian_consent_withdrawn_at || null,
          parentEmail: m.parent_email || ""
        };
      });

      setFamilyMembers(merged);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMembers(false);
    }
  };

  const loadJoinRequests = async () => {
    if (!store.activeFamilyId || !isOwner) {
      setLoadingRequests(false);
      return;
    }
    try {
      const res = await fetch(`/api/families/${store.activeFamilyId}/join-requests?status=pending`);
      if (res.ok) {
        const data = await res.json();
        setJoinRequests(data.requests ?? []);
      }
    } catch {} finally {
      setLoadingRequests(false);
    }
  };

  const loadSentInvites = async () => {
    if (!store.activeFamilyId || !isOwner) {
      setLoadingSentInvites(false);
      return;
    }
    try {
      const res = await fetch(`/api/families/${store.activeFamilyId}/sent-invites?status=pending`);
      if (res.ok) {
        const data = await res.json();
        setSentInvites(data.invites ?? []);
      }
    } catch {} finally {
      setLoadingSentInvites(false);
    }
  };

  const loadApprovalRequests = async () => {
    if (!store.activeFamilyId) {
      setApprovalRequests([]);
      return;
    }
    try {
      const res = await fetch(`/api/families/${store.activeFamilyId}/child-approval-requests`);
      if (res.ok) {
        const data = await res.json();
        setApprovalRequests(data.requests ?? []);
      }
    } catch {}
  };

  useEffect(() => {
    loadFamilyMembers();
    loadApprovalRequests();
  }, [store.activeFamilyId]);

  useEffect(() => {
    if (store.activeFamilyId && isOwner) {
      loadJoinRequests();
      loadSentInvites();
    } else {
      setLoadingRequests(false);
      setLoadingSentInvites(false);
    }
  }, [store.activeFamilyId, isOwner]);

  const validateChildProfile = () => {
    const errors: { familyName?: string; givenName?: string; grade?: string; interests?: string } = {};
    if (!editFamilyName.trim()) errors.familyName = "성을 입력해 주세요.";
    if (!editGivenName.trim()) errors.givenName = "이름을 입력해 주세요.";
    if (!editGrade) errors.grade = "학년을 선택해 주세요.";
    if (editInterests.length === 0) errors.interests = "관심사를 한 개 이상 선택해 주세요.";
    return errors;
  };

  const focusFirstChildProfileError = (errors: { familyName?: string; givenName?: string; grade?: string; interests?: string }) => {
    if (errors.familyName) { familyNameInputRef.current?.focus(); return; }
    if (errors.givenName) { givenNameInputRef.current?.focus(); return; }
    if (errors.grade) { gradeSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    if (errors.interests) { interestsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  };

  const isChildProfileDirty = () => {
    const orig = originalProfileRef.current;
    if (!orig) return false;
    const sortedOrig = [...orig.interests].sort().join(",");
    const sortedNow = [...editInterests].sort().join(",");
    return (
      orig.familyName !== editFamilyName.trim() ||
      orig.givenName !== editGivenName.trim() ||
      orig.grade !== editGrade ||
      sortedOrig !== sortedNow
    );
  };

  // 자녀 기본정보 저장 — 요금제는 이 함수가 절대 건드리지 않는다(§8, 프로필 저장과 요금제
  // 변경 분리). 성공 시 true, 검증/서버 실패 시 false를 반환해 호출부가 이어서 분기할 수 있다.
  const commitChildProfileSave = async (): Promise<boolean> => {
    const errors = validateChildProfile();
    if (Object.keys(errors).length > 0) {
      setSaveFieldErrors(errors);
      setSaveErrorSummary("입력하지 않은 항목이 있어요. 표시된 내용을 확인해 주세요.");
      focusFirstChildProfileError(errors);
      return false;
    }
    if (!editChild) return false;

    setSaveFieldErrors({});
    setSaveErrorSummary(null);
    setSaveServerError(null);
    setSaveState("saving");

    try {
      const res = await fetch(`/api/child/${editChild.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyName: editFamilyName.trim(),
          givenName: editGivenName.trim(),
          grade: editGrade,
          interests: editInterests,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveState("error");
        setSaveServerError(
          res.status === 403
            ? "이 자녀의 정보를 수정할 권한이 없어요."
            : (data.error || "자녀 정보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.")
        );
        return false;
      }

      updateChild(editChild.id, {
        familyName: editFamilyName.trim(),
        givenName: editGivenName.trim(),
        grade: editGrade,
        interests: editInterests,
      } as any);
      originalProfileRef.current = {
        familyName: editFamilyName.trim(),
        givenName: editGivenName.trim(),
        grade: editGrade,
        interests: [...editInterests],
      };
      setSaveState("success");
      await loadFamilyMembers();
      // requests/request_parent_child_profile_sync.md §5.3 — 저장 성공 직후 "아이 승인
      // 요청 현황" 카드도 함께 갱신한다(그동안 이 화면만 저장 후 재조회 대상에서
      // 빠져 있어 승인 완료된 아이도 가입 신청 당시 값이 계속 보이던 버그의 원인이었음).
      await loadApprovalRequests();
      return true;
    } catch {
      setSaveState("error");
      setSaveServerError("자녀 정보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
      return false;
    }
  };

  const refreshPlanRequest = async (childId: string) => {
    try {
      const res = await fetch(`/api/child/${childId}/plan-change-request`);
      const data = await res.json().catch(() => ({ request: null }));
      setPlanRequest(res.ok ? (data.request ?? null) : null);
    } catch {
      setPlanRequest(null);
    }
  };

  // 요금제 변경 요청 실제 생성 — 부모가 확인 다이얼로그(또는 "저장하고 진행")를 통해
  // 요금제 변경 즉시 적용 (관리자 승인 불필요)
  const requestPlanChange = async (tier: number) => {
    if (!editChild) return;
    setPlanRequestSubmitting(true);
    setPlanRequestError(null);
    try {
      const res = await fetch(`/api/child/${editChild.id}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPlanRequestError(data.error || "요금제 변경에 실패했어요.");
        return;
      }
      
      // 즉시 UI 업데이트
      setEditOriginalTier(tier);
      setShowPlanAccepted({ requestedTier: tier, currentTier: editOriginalTier });
      
      setEditChild(prev => prev ? { ...prev, tier } : null);
    } catch {
      setPlanRequestError("네트워크 오류가 발생했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPlanRequestSubmitting(false);
      setPendingPlanTier(null);
    }
  };

  // 요금제 카드 클릭
  const handlePlanCardClick = (tier: number) => {
    if (planRequestSubmitting) return; // codex 044 리뷰: 처리 중 다른 플랜 재선택으로 병렬 요청 방지
    if (tier === editOriginalTier) return;
    if (tier === 3) return; // 053: Care Premium은 모든 환경에서 차단
    // codex 044 리뷰: planRequest는 관리자 승인이 필요했던 구 플랜변경요청 흐름의 잔존값이다.
    // 044는 Care Start/Insight 간 변경을 승인 없이 즉시 반영하도록 바뀌었으므로, 실제 사용
    // 이력 조회 결과 실사용자에게 남아있던 오래된 pending 요청 하나가 이 체크 때문에 신규
    // self-service 변경 자체를 조용히 막고 있었다(사용자에게 안내조차 없음) - 제거한다.
    setPendingPlanTier(tier);
    if (isChildProfileDirty()) {
      setShowUnsavedGate(true);
    } else {
      setShowPlanConfirm(true);
    }
  };

  const handleCancelPlanRequest = async () => {
    if (!editChild) return;
    setCancellingPlanRequest(true);
    try {
      const res = await fetch(`/api/child/${editChild.id}/plan-change-request`, { method: "DELETE" });
      if (res.ok) await refreshPlanRequest(editChild.id);
    } catch {} finally {
      setCancellingPlanRequest(false);
    }
  };

  const handleWithdrawConsent = async () => {
    if (!withdrawTarget) return;
    setWithdrawLoading(true);
    setWithdrawError(null);
    try {
      const res = await fetch(`/api/child/${withdrawTarget.childId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ withdrawConsent: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWithdrawError(data.error || "동의 철회에 실패했습니다.");
        return;
      }
      setWithdrawTarget(null);
      await loadFamilyMembers();
    } catch {
      setWithdrawError("네트워크 에러가 발생했습니다.");
    } finally {
      setWithdrawLoading(false);
    }
  };

  const handleDeleteChild = async () => {
    if (!deleteChildTarget) return;
    if (deleteChildConfirmName.trim() !== deleteChildTarget.displayName.trim()) {
      setDeleteChildError("아이 이름이 정확히 일치하지 않습니다.");
      return;
    }

    setDeleteChildLoading(true);
    setDeleteChildError(null);

    try {
      const res = await fetch(`/api/child/${deleteChildTarget.childId}`, {
        method: "DELETE",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteChildError(data.error || "삭제에 실패했습니다.");
        return;
      }

      setDeleteChildTarget(null);
      setDeleteChildConfirmName("");
      
      await loadFamilyMembers();

      const { syncChildrenFromDB } = await import("@/lib/store");
      await syncChildrenFromDB();
    } catch {
      setDeleteChildError("네트워크 에러가 발생했습니다.");
    } finally {
      setDeleteChildLoading(false);
    }
  };

  const handleAddChild = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);

    if (!addFamilyName.trim()) { setAddError("성을 입력해주세요."); return; }
    if (!addGivenName.trim()) { setAddError("이름을 입력해주세요."); return; }
    if (!addChildGender) { setAddError("성별을 선택해주세요."); return; }
    if (!addUsername.trim()) { setAddError("아이디를 입력해주세요."); return; }
    if (addPassword.length < 6) { setAddError("비밀번호는 6자 이상이어야 합니다."); return; }
    if (addChildInterests.length === 0) { setAddError("관심사를 하나 이상 선택해주세요."); return; }
    if (!addChildConsent) { setAddError("법정대리인 동의가 필요합니다."); return; }

    setAddLoading(true);
    try {
      const body = {
        username: addUsername.trim(),
        password: addPassword,
        familyName: addFamilyName.trim(),
        givenName: addGivenName.trim(),
        gender: addChildGender,
        grade: addChildGrade,
        interests: addChildInterests,
        guardian_consent: addChildConsent
      };

      const res = await fetch(`/api/families/${store.activeFamilyId}/children`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error || "승인 요청 접수에 실패했습니다.");
        return;
      }

      setAddFamilyName("");
      setAddGivenName("");
      setAddUsername("");
      setAddPassword("");
      setAddChildGender("");
      setAddChildInterests([]);
      setAddChildConsent(false);
      setActiveMenu(null);
      if (data.request?.status === "approved") {
        setShowBetaApprovedModal(true);
      } else if (data.request?.status === "PENDING_PAYMENT") {
        setShowPaymentModal(true);
      } else {
        setAddSuccessMessage("승인 요청이 접수되었습니다. 관리자 승인 후 아이 계정이 만들어져요.");
      }
      await loadApprovalRequests();
      await loadFamilyMembers(); // Reload members to show the newly approved child immediately
    } catch {
      setAddError("네트워크 에러가 발생했습니다.");
    } finally {
      setAddLoading(false);
    }
  };

  const handleInviteParent = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    if (!inviteEmail.trim()) return;

    setAddLoading(true);
    try {
      const res = await fetch(`/api/families/${store.activeFamilyId}/invite-member`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim() })
      });

      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error || "초대에 실패했습니다.");
        return;
      }

      setInviteEmail("");
      alert("초대장을 전송했습니다!");
      await loadFamilyMembers();
      await loadSentInvites();
    } catch {
      setAddError("네트워크 에러가 발생했습니다.");
    } finally {
      setAddLoading(false);
    }
  };

  const handleSaveNickname = async () => {
    if (!nicknameInput.trim() || nicknameInput.length > 30) return;
    setSavingNickname(true);
    setNicknameError(null);
    setNicknameSuccess(false);

    try {
      const res = await fetch("/api/parents/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nicknameInput.trim() }),
      });

      if (res.ok) {
        setNicknameSuccess(true);
        await loadFamilyMembers();
      } else {
        const data = await res.json().catch(() => null);
        setNicknameError(data?.error || "닉네임 변경에 실패했습니다.");
      }
    } catch {
      setNicknameError("네트워크 에러가 발생했습니다.");
    } finally {
      setSavingNickname(false);
    }
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await revokeCurrentPushInstallation();
    await supabase.auth.signOut().catch(() => {});
    clearStore();
    router.push("/login");
  };

  const handleWithdrawal = async () => {
    setWithdrawalLoading(true);
    setWithdrawalError(null);
    try {
      interface WithdrawRequestBody {
        reason: string;
        confirmedLastGuardian: boolean;
        successorUserId?: string;
        password?: string;
      }
      const body: WithdrawRequestBody = { 
        reason: withdrawalReason,
        confirmedLastGuardian: withdrawalLastGuardianAgreed
      };
      if (withdrawalSuccessor) body.successorUserId = withdrawalSuccessor;
      if (userProvider === "email") body.password = withdrawalPassword;

      const res = await fetch("/api/account/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      
      if (!res.ok) {
        if (res.status === 409) {
          if (data.error === "last_guardian_confirmation_required") {
            setWithdrawalError("가족의 모든 데이터가 함께 삭제되는 것에 동의해야 탈퇴할 수 있습니다.");
          } else {
            setWithdrawalError("관리자 권한을 승계할 보호자를 선택해야 합니다.");
          }
          loadFamilyMembers();
          setWithdrawalStep(1);
        } else if (res.status === 401) {
          if (userProvider !== "email" && data.error === "재로그인 후 다시 시도해주세요") {
            setWithdrawalError("보안을 위해 다시 로그인 후 시도해주세요.");
            setTimeout(async () => {
              const supabase = createClient();
              await supabase.auth.signOut().catch(() => {});
              clearStore();
              router.push("/login");
            }, 2000);
          } else {
            setWithdrawalError("비밀번호가 일치하지 않습니다.");
          }
        } else {
          setWithdrawalError(data.error || "탈퇴 처리에 실패했습니다.");
        }
        setWithdrawalLoading(false);
        return;
      }

      alert("회원 탈퇴가 완료되었습니다.");
      const supabase = createClient();
      await supabase.auth.signOut().catch(() => {});
      clearStore();
      router.push("/login");
    } catch (err) {
      setWithdrawalError("오류가 발생했습니다.");
      setWithdrawalLoading(false);
    }
  };

  const toggleInterest = (item: string, isEdit: boolean) => {
    if (isEdit) {
      setEditInterests((prev) =>
        prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
      );
      if (saveFieldErrors.interests) {
        setSaveFieldErrors((prev) => ({ ...prev, interests: undefined }));
      }
    } else {
      setAddChildInterests((prev) =>
        prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
      );
    }
  };

  const otherActiveGuardians = useMemo(() => {
    return familyMembers.filter(m => (m.role === "parent" || m.role === "owner_parent") && !m.isMe);
  }, [familyMembers]);

  if (!mounted) {
    return (
      <DemoFrame>
        <div className="h-full flex flex-col overflow-hidden md:h-auto md:overflow-visible" style={{ background: "#f3f4f6" }}>
          <ParentHeader />
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3 md:flex-none md:h-auto md:overflow-visible md:pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonBox key={i} className="h-16" />
            ))}
            <SkeletonBox className="h-12 mt-3" />
          </div>
        </div>
      </DemoFrame>
    );
  }

  const menuToggle = (menu: "add_child" | "edit_child" | "family_members") => {
    setActiveMenu((prev) => (prev === menu ? null : menu));
    setAddError(null);
  };

  const additionalGuardianCount = familyMembers.filter(m => m.role === "parent").length;

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden md:h-auto md:overflow-visible" style={{ background: "#f3f4f6" }}>
        <ParentHeader />

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3 md:flex-none md:h-auto md:overflow-visible md:pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]">
          {/* 1. 아이 추가 메뉴 카드 */}
          <div
            id="add-child-section"
            onClick={() => menuToggle("add_child")}
            className="bg-white rounded-2xl px-4 py-4 shadow-sm flex flex-col gap-3 cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0" style={{ background: "#f3f4f6" }}>
                ➕
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: "var(--color-k-text-primary)" }}>아이 추가</p>
                <p className="text-[11px]" style={{ color: "#6b7280" }}>새로운 아이 계정을 추가해요</p>
              </div>
              <span className="text-sm" style={{ color: "#6b7280", transform: activeMenu === "add_child" ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>→</span>
            </div>

            {activeMenu === "add_child" && (
              <div className="pt-3 border-t border-gray-100" onClick={(e) => e.stopPropagation()}>
                {isOwner ? (
                  <form onSubmit={handleAddChild} className="flex flex-col gap-3">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="성"
                        value={addFamilyName}
                        onChange={(e) => setAddFamilyName(e.target.value)}
                        className="w-1/3 px-3.5 py-2 text-xs border border-gray-200 rounded-xl outline-none bg-gray-50/50"
                      />
                      <input
                        type="text"
                        placeholder="이름"
                        value={addGivenName}
                        onChange={(e) => setAddGivenName(e.target.value)}
                        className="w-2/3 px-3.5 py-2 text-xs border border-gray-200 rounded-xl outline-none bg-gray-50/50"
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="아이디 (로그인용)"
                      value={addUsername}
                      onChange={(e) => setAddUsername(e.target.value)}
                      className="px-3.5 py-2 text-xs border border-gray-200 rounded-xl outline-none bg-gray-50/50"
                    />
                    <input
                      type="password"
                      placeholder="비밀번호 (6자 이상)"
                      value={addPassword}
                      onChange={(e) => setAddPassword(e.target.value)}
                      className="px-3.5 py-2 text-xs border border-gray-200 rounded-xl outline-none bg-gray-50/50"
                    />
                    <div>
                      <p className="text-[10px] font-bold text-gray-500 mb-1 px-1">성별</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {[{ v: "male", label: "남자아이" }, { v: "female", label: "여자아이" }].map((opt) => (
                          <button
                            key={opt.v}
                            type="button"
                            onClick={() => setAddChildGender(opt.v)}
                            className={`py-1.5 text-[10px] font-bold rounded-xl border ${
                              addChildGender === opt.v ? "bg-[var(--color-k-navy)] text-white border-transparent" : "bg-white border-gray-200 text-gray-600"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold text-gray-500 mb-1 px-1">학년 선택</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {GRADES.map((g) => (
                          <button
                            key={g}
                            type="button"
                            onClick={() => setAddChildGrade(g)}
                            className={`py-1.5 text-[10px] font-bold rounded-xl border ${
                              addChildGrade === g ? "bg-[var(--color-k-navy)] text-white border-transparent" : "bg-white border-gray-200 text-gray-600"
                            }`}
                          >
                            {g}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold text-gray-500 mb-1 px-1">아이 관심사 선택</p>
                      <div className="flex flex-wrap gap-1.5">
                        {INTERESTS.map((interest) => {
                          const has = addChildInterests.includes(interest);
                          return (
                            <button
                              key={interest}
                              type="button"
                              onClick={() => toggleInterest(interest, false)}
                              className={`px-3 py-1 text-[10px] font-bold rounded-full border ${
                                has ? "bg-[var(--color-k-orange)] text-white border-transparent" : "bg-white border-gray-200 text-gray-600"
                              }`}
                            >
                              {interest}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div
                      className="max-h-28 overflow-y-auto md:max-h-none md:overflow-y-visible whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-2 text-[9px] leading-relaxed text-gray-500"
                    >
                      {CONSENT_DOCUMENT_TEXT}
                    </div>
                    <label className="flex items-center gap-2 px-1 mt-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={addChildConsent}
                        onChange={(e) => setAddChildConsent(e.target.checked)}
                        className="w-4 h-4 rounded text-[var(--color-k-navy)]"
                      />
                      <span className="text-[10px] font-bold text-gray-500">위 내용을 확인했으며, 법정대리인으로서 개인정보 수집·이용에 동의합니다</span>
                    </label>

                    {addError && <p className="text-xs text-red-500 px-1">{addError}</p>}
                    <button
                      type="submit"
                      disabled={addLoading}
                      className="w-full py-2.5 rounded-xl text-white text-xs font-bold active:scale-95 transition-transform md:scroll-mb-[calc(7rem+env(safe-area-inset-bottom,0px))]"
                      style={{ background: "var(--color-k-navy)" }}
                    >
                      {addLoading ? "승인 요청 접수 중..." : "승인 요청 보내기"}
                    </button>
                    <p className="text-[9px] text-gray-400 px-1 text-center leading-relaxed">
                      제출 후 관리자 승인이 완료되면 아이 계정이 만들어져요.
                    </p>
                  </form>
                ) : (
                  <p className="text-[10px] text-gray-400 text-center py-2">가족 오너 권한이 있는 보호자만 아이를 등록할 수 있습니다.</p>
                )}
              </div>
            )}
          </div>

          {/* 1-1. 아이 승인 요청 상태 (053 - 관리자 승인 전/거절/실패 상태만 조회) */}
          {approvalRequests.length > 0 && (
            <div className="bg-white rounded-2xl px-4 py-4 shadow-sm flex flex-col gap-3">
              <p className="text-sm font-bold" style={{ color: "var(--color-k-text-primary)" }}>아이 승인 요청 현황</p>
              <div className="flex flex-col gap-2">
                {approvalRequests.map((req) => {
                  const statusMeta: Record<string, { label: string; color: string; bg: string }> = {
                    pending: { label: "관리자 승인 대기 중", color: "#92400e", bg: "#fef3c7" },
                    creation_failed: { label: "프로필 생성 실패 - 확인 중", color: "#991b1b", bg: "#fee2e2" },
                    rejected: { label: "승인 거절됨", color: "#6b7280", bg: "#f3f4f6" },
                    approved: { label: "승인 완료", color: "#065f46", bg: "#d1fae5" },
                  };
                  const meta = statusMeta[req.status] ?? statusMeta.pending;
                  return (
                    <div key={req.id} className="rounded-xl p-3 border border-gray-100 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-800 truncate">
                          {req.profileMissing ? "아이 정보" : `${req.family_name}${req.given_name}`} · {req.grade}
                        </p>
                        {req.status === "rejected" && req.rejected_reason && (
                          <p className="text-[10px] text-gray-500 mt-0.5 truncate">사유: {req.rejected_reason}</p>
                        )}
                        {req.status === "creation_failed" && (
                          <p className="text-[10px] text-gray-500 mt-0.5 truncate">관리자가 확인 후 다시 처리할 예정이에요</p>
                        )}
                        {req.status === "approved" && req.profileMissing && (
                          <p className="text-[10px] mt-0.5 truncate" style={{ color: "#991b1b" }}>정보 확인 필요 — 잠시 후 다시 확인해 주세요</p>
                        )}
                      </div>
                      <span
                        className="shrink-0 px-2 py-1 rounded-full text-[10px] font-bold"
                        style={{ color: meta.color, background: meta.bg }}
                      >
                        {meta.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {addSuccessMessage && (
            <div className="bg-white rounded-2xl px-4 py-3 shadow-sm">
              <p className="text-xs font-bold text-center" style={{ color: "var(--color-k-navy)" }}>{addSuccessMessage}</p>
            </div>
          )}

          {showBetaApprovedModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
              <div className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4">
                <h3 className="text-lg font-bold text-center" style={{ color: "var(--color-k-navy)" }}>승인되었습니다</h3>
                <p className="text-sm text-center text-gray-700">아이 등록이 완료되었습니다.<br />지금 바로 내친구 케이를 이용할 수 있습니다.</p>
                <button
                  onClick={() => setShowBetaApprovedModal(false)}
                  className="w-full py-3 rounded-full text-white font-bold"
                  style={{ background: "var(--color-k-orange)" }}
                >
                  확인
                </button>
              </div>
            </div>
          )}

          {showPaymentModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
              <div className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4">
                <h3 className="text-lg font-bold text-center" style={{ color: "var(--color-k-navy)" }}>결제가 필요합니다</h3>
                <p className="text-sm text-center text-gray-700">아이 등록과 서비스 이용을 위해 결제가 필요합니다.<br />결제 완료 후 아이 계정이 자동 승인됩니다.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowPaymentModal(false)}
                    className="flex-1 py-3 rounded-full font-bold border border-gray-300 text-gray-600"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => {
                      setShowPaymentModal(false);
                      alert("결제 연동이 아직 준비되지 않았습니다. (개발 중)");
                    }}
                    className="flex-1 py-3 rounded-full text-white font-bold"
                    style={{ background: "var(--color-k-orange)" }}
                  >
                    결제 페이지로 이동
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 2. 아이 프로필 정보 등록 메뉴 카드 (자녀 프로필 수정 전용) */}
          <div
            onClick={() => menuToggle("edit_child")}
            className="bg-white rounded-2xl px-4 py-4 shadow-sm flex flex-col gap-3 cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0" style={{ background: "#f3f4f6" }}>
                📝
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: "var(--color-k-text-primary)" }}>아이 정보 관리</p>
                <p className="text-[11px]" style={{ color: "#6b7280" }}>이름, 학년, 관심사, 요금제를 관리해요</p>
              </div>
              <span className="text-sm" style={{ color: "#6b7280", transform: activeMenu === "edit_child" ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>→</span>
            </div>

            {activeMenu === "edit_child" && (
              <div className="pt-3 border-t border-gray-100 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
                {/* 자녀 정보 수정 폼 */}
                {familyMembers.filter(m => m.role === "child").length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-3">등록된 자녀가 없습니다.</p>
                ) : (
                  <div className="flex flex-col gap-2 p-3 bg-gray-50/50 rounded-xl border border-gray-150">
                    <p className="text-[10px] font-bold text-gray-500">자녀 프로필 수정</p>
                    <div className="flex flex-col gap-3.5 md:gap-2">
                      {familyMembers.filter(m => m.role === "child").map((m) => (
                        <div key={m.memberId} className={isMobileCard ? "block w-full bg-white border border-gray-200/80 rounded-xl p-3.5 shadow-sm" : "flex flex-row items-center justify-between gap-3 bg-white border border-gray-100 rounded-xl p-3 shadow-none min-w-0"}>
                          {/* 1. 상단 아이 이름·학년 정보 영역 (모바일 w-full 독립 블록, keep-all) */}
                          <div className={isMobileCard ? "block w-full mb-3" : "w-auto min-w-0 flex items-center gap-1.5"}>
                            <span className={isMobileCard ? "block w-full text-xs font-bold text-gray-800 break-keep" : "inline text-xs font-bold text-gray-800 whitespace-nowrap"}>
                              🧒 {m.displayName} ({m.grade})
                            </span>
                          </div>

                          {/* 2. 하단 액션 버튼 영역 (모바일 구분선 아래 독립 블록) */}
                          {m.guardianConsentWithdrawnAt ? (
                            <div className={isMobileCard ? "block w-full border-t border-gray-100/80 pt-3" : "w-auto flex items-center gap-1.5 shrink-0"}>
                              <div className={isMobileCard ? "grid grid-cols-1 gap-2 sm:grid-cols-2 w-full" : "flex items-center gap-1.5 w-auto"}>
                                <span className={isMobileCard ? "block w-full text-[10px] bg-red-50 text-red-500 font-bold py-2 rounded-lg text-center" : "text-[10px] bg-red-50 text-red-500 font-bold px-2.5 py-1 rounded-lg text-center"}>
                                  동의 철회됨
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setLoginGuideChild({ id: m.childId, name: m.displayName, grade: m.grade })}
                                  className={isMobileCard ? "block w-full text-[10px] bg-[#EFF4FA] text-[#10315B] font-bold py-2 rounded-lg text-center" : "text-[10px] bg-[#EFF4FA] text-[#10315B] font-bold px-2.5 py-1 rounded-lg text-center whitespace-nowrap"}
                                >
                                  로그인 방법
                                </button>
                                {isOwner && (
                                  <button
                                    onClick={() => {
                                      setDeleteChildError(null);
                                      setDeleteChildTarget({ childId: m.childId, displayName: m.displayName });
                                      setDeleteChildConfirmName("");
                                    }}
                                    className={isMobileCard ? "block w-full text-[10px] bg-red-600 text-white font-bold py-2 rounded-lg cursor-pointer hover:bg-red-700 transition-colors text-center" : "text-[10px] bg-red-600 text-white font-bold px-2.5 py-1 rounded-lg cursor-pointer hover:bg-red-700 transition-colors text-center"}
                                  >
                                    아이 삭제
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className={isMobileCard ? "block w-full border-t border-gray-100/80 pt-3" : "w-auto flex items-center gap-1.5 shrink-0"}>
                              {/* Block 2: 수정하기·동의 철회 (모바일 2열 grid 독립 블록) */}
                              <div className={isMobileCard ? "grid grid-cols-2 gap-2 w-full mb-2" : "flex items-center gap-1.5 w-auto"}>
                                <button
                                  onClick={() => {
                                    setEditChild({
                                      id: m.childId,
                                      name: m.displayName,
                                      grade: m.grade,
                                      interests: m.interests
                                    });
                                    const familyName = m.familyName ?? "";
                                    const givenName = m.givenName ?? "";
                                    const grade = m.grade;
                                    const interests = m.interests ?? [];
                                    setEditFamilyName(familyName);
                                    setEditGivenName(givenName);
                                    setEditGrade(grade);
                                    setEditInterests(interests);
                                    setEditOriginalTier(m.tier ?? 1);
                                    originalProfileRef.current = { familyName, givenName, grade, interests: [...interests] };
                                    setSaveFieldErrors({});
                                    setSaveErrorSummary(null);
                                    setSaveServerError(null);
                                    setSaveState("idle");
                                    setPlanRequest(null);
                                    setPlanRequestError(null);
                                    setPendingPlanTier(null);
                                    refreshPlanRequest(m.childId);
                                  }}
                                  className={isMobileCard ? "block w-full text-[10px] bg-[#f3f4f6] text-gray-600 font-bold py-2 rounded-lg cursor-pointer text-center whitespace-nowrap" : "text-[10px] bg-[#f3f4f6] text-gray-600 font-bold px-2.5 py-1 rounded-lg cursor-pointer text-center whitespace-nowrap"}
                                >
                                  수정하기
                                </button>
                                <button
                                  onClick={() => {
                                    setWithdrawError(null);
                                    setWithdrawTarget({ childId: m.childId, displayName: m.displayName });
                                  }}
                                  className={isMobileCard ? "block w-full text-[10px] bg-red-50 text-red-500 font-bold py-2 rounded-lg cursor-pointer text-center whitespace-nowrap" : "text-[10px] bg-red-50 text-red-500 font-bold px-2.5 py-1 rounded-lg cursor-pointer text-center whitespace-nowrap"}
                                >
                                  동의 철회
                                </button>
                              </div>
                              {/* Block 3: 로그인 안내·아이 삭제 */}
                              <div className={isMobileCard ? "grid grid-cols-1 gap-2 w-full" : "flex items-center gap-1.5 w-auto"}>
                                <button
                                  type="button"
                                  onClick={() => setLoginGuideChild({ id: m.childId, name: m.displayName, grade: m.grade })}
                                  className={isMobileCard ? "block w-full text-[10px] bg-[#EFF4FA] text-[#10315B] font-bold py-2 rounded-lg text-center whitespace-nowrap" : "text-[10px] bg-[#EFF4FA] text-[#10315B] font-bold px-2.5 py-1 rounded-lg text-center whitespace-nowrap"}
                                >
                                  로그인 방법
                                </button>
                                {isOwner && (
                                <button
                                  onClick={() => {
                                    setDeleteChildError(null);
                                    setDeleteChildTarget({ childId: m.childId, displayName: m.displayName });
                                    setDeleteChildConfirmName("");
                                  }}
                                  className={isMobileCard ? "block w-full text-[10px] bg-red-600 text-white font-bold py-2 rounded-lg cursor-pointer hover:bg-red-700 transition-colors text-center whitespace-nowrap" : "text-[10px] bg-red-600 text-white font-bold px-2.5 py-1 rounded-lg cursor-pointer hover:bg-red-700 transition-colors text-center whitespace-nowrap"}
                                >
                                  아이 삭제
                                </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 3. 가족 구성원 관리 메뉴 카드 (보호자 이름/알림/가족 구성원 목록) */}
          <div
            onClick={() => menuToggle("family_members")}
            className="bg-white rounded-2xl px-4 py-4 shadow-sm flex flex-col gap-3 cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0" style={{ background: "#f3f4f6" }}>
                👨‍👩‍👧
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: "var(--color-k-text-primary)" }}>보호자 설정</p>
                <p className="text-[11px]" style={{ color: "#6b7280" }}>내 이름, 알림, 보호자 구성원을 관리해요</p>
              </div>
              <span className="text-sm" style={{ color: "#6b7280", transform: activeMenu === "family_members" ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>→</span>
            </div>

            {activeMenu === "family_members" && (
              <div className="pt-3 border-t border-gray-100 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
                {/* [내 이름 설정 섹션] - 본인 프로필 수정 (항상 노출) */}
                <div className="flex flex-col gap-2 p-3 bg-gray-50/50 rounded-xl border border-gray-150">
                  <p className="text-[10px] font-bold text-gray-500">내 이름 수정</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={nicknameInput}
                      onChange={(e) => setNicknameInput(e.target.value)}
                      placeholder="예) 서아엄마"
                      className="flex-1 px-3 py-1.5 text-xs border border-gray-200 rounded-xl outline-none bg-white"
                    />
                    <button
                      onClick={handleSaveNickname}
                      disabled={savingNickname || !nicknameInput.trim()}
                      className="px-4 py-1.5 bg-[var(--color-k-navy)] text-white text-xs font-bold rounded-xl disabled:opacity-50 cursor-pointer active:scale-95 transition-transform"
                    >
                      {savingNickname ? "저장중" : "변경"}
                    </button>
                  </div>
                  {nicknameSuccess && <p className="text-[10px] text-green-600 px-1">닉네임이 성공적으로 변경되었습니다.</p>}
                  {nicknameError && <p className="text-[10px] text-red-500 px-1">{nicknameError}</p>}
                </div>

                {/* 알림 설정 */}
                <div className="flex flex-col gap-2 p-3 bg-gray-50/50 rounded-xl border border-gray-150">
                  <p className="text-[10px] font-bold text-gray-500">알림 환경 설정</p>
                  <div className="flex flex-col gap-2.5">
                    <label className="flex items-center justify-between text-xs cursor-pointer">
                      <div>
                        <p className="font-bold text-gray-800">일일 리포트 도착 알림</p>
                        <p className="text-[10px] text-gray-400">자녀가 케이와 대화 후 일일 요약 분석 알림</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={reportAlert}
                        disabled={pushSaving}
                        onChange={(e) => handleReportAlertToggle(e.target.checked)}
                        className="w-4 h-4 rounded text-[var(--color-k-navy)]"
                      />
                    </label>
                    {pushError && <p className="text-[10px] text-red-500 px-1">{pushError}</p>}
                    <label className="flex items-center justify-between text-xs cursor-pointer">
                      <div>
                        <p className="font-bold text-gray-800">주간 종합 요약 알림</p>
                        <p className="text-[10px] text-gray-400">매주 일요일 자녀의 주간 종합 분석 알림</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={weeklySummary}
                        onChange={(e) => setNotifSetting("weeklySummary", e.target.checked)}
                        className="w-4 h-4 rounded text-[var(--color-k-navy)]"
                      />
                    </label>
                  </div>
                </div>

                {/* [가족 구성원 보호자 리스트 및 초대 섹션] */}
                {(additionalGuardianCount >= 1 || sentInvites.length > 0 || isOwner) && (
                  <div className="flex flex-col gap-2 p-3 bg-gray-50/50 rounded-xl border border-gray-150">
                    <p className="text-[10px] font-bold text-gray-500">가족 구성원 보호자</p>
                    
                    {/* 1. 이미 등록된 보호자가 1명 이상인 경우 기존 리스트 표시 */}
                    {additionalGuardianCount >= 1 && (
                      <div className="flex flex-col gap-1.5">
                        {familyMembers.filter(m => m.role !== "child").map((m) => (
                          <div key={m.memberId} className="flex justify-between items-center bg-white border border-gray-100 rounded-xl p-2.5">
                            <div>
                              <p className="text-xs font-bold text-gray-800">{m.displayName} ({m.role === "owner_parent" ? "오너" : "배우자"})</p>
                              <p className="text-[9px] text-gray-400">{m.parentEmail || m.username}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 2. 등록된 배우자가 없고, 대기 중인 초대가 있는 경우 대기 UI 표시 */}
                    {additionalGuardianCount === 0 && sentInvites.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        {sentInvites.map((invite) => (
                          <div key={invite.id} className="flex justify-between items-center bg-white border border-gray-100 rounded-xl p-2.5">
                            <div>
                              <p className="text-xs font-bold text-gray-800">{invite.target_email}</p>
                              <p className="text-[9px] text-gray-400">초대 일시: {invite.created_at ? new Date(invite.created_at).toLocaleDateString() : ""}</p>
                            </div>
                            <span className="text-[9px] bg-yellow-50 text-yellow-600 font-bold px-2 py-1 rounded-lg text-center shrink-0">
                              초대 대기중
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 3. 등록된 배우자도 없고 대기 중인 초대도 없을 때, 오너이면 안내 문구 표시 */}
                    {additionalGuardianCount === 0 && sentInvites.length === 0 && isOwner && (
                      <p className="text-[11px] text-gray-500 py-1">
                        아직 연결된 다른 보호자가 없습니다. 보호자를 초대해보세요!
                      </p>
                    )}

                    {/* 4. 초대 폼 (isOwner이고 배우자 초대가 가능한 상태인 경우 그대로 유지) */}
                    {isOwner && familyMembers.filter(m => m.role !== "child").length < 2 && (
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        <p className="text-[9px] text-gray-400 mb-1.5">보호자(배우자) 이메일 초대</p>
                        <form onSubmit={handleInviteParent} className="flex gap-2">
                          <input
                            type="email"
                            placeholder="spouse@example.com"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            className="flex-1 px-3 py-1.5 text-xs border border-gray-200 rounded-xl outline-none bg-white"
                          />
                          <button
                            type="submit"
                            className="px-4 py-1.5 bg-[var(--color-k-navy)] text-white text-xs font-bold rounded-xl active:scale-95 transition-transform"
                          >
                            초대
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                )}
                
                {/* 5. 위험 작업 영역 (회원 탈퇴) */}
                <div className="mt-2 pt-4 border-t border-gray-100 flex flex-col gap-2">
                  <p className="text-[10px] font-bold text-gray-500 px-1">위험 작업</p>
                  
                  <button
                    type="button"
                    onClick={() => setWithdrawalPanelOpen(v => !v)}
                    aria-expanded={withdrawalPanelOpen}
                    className="w-full flex items-center gap-3 p-3 bg-white hover:bg-gray-50 rounded-xl border border-gray-150 transition-colors text-left cursor-pointer"
                    style={{ minHeight: "44px" }}
                  >
                    <span className="text-red-500 text-sm shrink-0">🚪</span>
                    <div className="flex-1">
                      <p className="text-xs font-bold text-red-500">회원 탈퇴</p>
                      <p className="text-[10px] text-gray-500">계정과 관련 데이터를 삭제합니다</p>
                    </div>
                    <span className="text-sm text-gray-400" style={{ transform: withdrawalPanelOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>→</span>
                  </button>

                  {withdrawalPanelOpen && (
                    <div className="pt-2 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
                      {withdrawalStep === 1 ? (
                        <div className="flex flex-col gap-3">
                          <div className="p-3 bg-red-50 rounded-xl border border-red-100">
                            <p className="text-xs font-bold text-red-600 mb-1">⚠️ 탈퇴 전 확인해주세요</p>
                            <p className="text-[10px] text-red-500 leading-relaxed">
                              탈퇴하면 계정과 데이터가 30일 후 영구 삭제됩니다.<br />
                              30일 이내에는 관리자 승인을 통해 복구할 수 있습니다.
                            </p>
                          </div>

                          <textarea
                            value={withdrawalReason}
                            onChange={(e) => setWithdrawalReason(e.target.value)}
                            placeholder="탈퇴 사유를 남겨주시면 서비스 개선에 큰 도움이 됩니다. (선택)"
                            className="w-full p-3 text-xs border border-gray-200 rounded-xl bg-gray-50 outline-none resize-none"
                            rows={3}
                          />

                          {isOwner && otherActiveGuardians.length > 0 && (
                            <div className="flex flex-col gap-2">
                              <p className="text-[10px] font-bold text-gray-500">가족 관리자 권한 승계</p>
                              <p className="text-[10px] text-gray-400">다른 보호자에게 관리자 권한을 넘겨야 탈퇴할 수 있습니다.</p>
                              <select
                                value={withdrawalSuccessor}
                                onChange={(e) => setWithdrawalSuccessor(e.target.value)}
                                className="p-2 text-xs border border-gray-200 rounded-xl bg-white outline-none"
                              >
                                <option value="">승계할 보호자 선택</option>
                                {otherActiveGuardians.map(m => (
                                  <option key={m.userId} value={m.userId}>{m.displayName} ({m.parentEmail || "이메일 알 수 없음"})</option>
                                ))}
                              </select>
                            </div>
                          )}

                          {isOwner && otherActiveGuardians.length === 0 && (
                            <div className="flex flex-col gap-2 mt-1">
                              <p className="text-xs font-bold text-red-600 leading-relaxed">
                                현재 가족의 마지막 보호자입니다. 탈퇴하면 가족과 등록된 아이 및 관련 데이터가 함께 탈퇴 처리되며 30일 동안 보관 후 삭제됩니다.
                              </p>
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={withdrawalLastGuardianAgreed}
                                  onChange={(e) => setWithdrawalLastGuardianAgreed(e.target.checked)}
                                  className="w-4 h-4 shrink-0 rounded text-red-500"
                                />
                                <span className="text-[10px] font-bold text-gray-600">가족의 모든 데이터가 함께 삭제되는 것에 동의합니다.</span>
                              </label>
                            </div>
                          )}

                          <label className="flex items-center gap-2 cursor-pointer mt-2">
                            <input
                              type="checkbox"
                              checked={withdrawalAgreed}
                              onChange={(e) => setWithdrawalAgreed(e.target.checked)}
                              className="w-4 h-4 shrink-0 rounded text-red-500"
                            />
                            <span className="text-[10px] font-bold text-gray-600">안내 사항을 모두 확인했으며, 탈퇴에 동의합니다.</span>
                          </label>

                          <button
                            onClick={() => setWithdrawalStep(2)}
                            disabled={
                              !withdrawalAgreed || 
                              (isOwner && otherActiveGuardians.length > 0 && !withdrawalSuccessor) || 
                              (isOwner && otherActiveGuardians.length === 0 && !withdrawalLastGuardianAgreed)
                            }
                            className="w-full py-2.5 rounded-xl text-white text-xs font-bold bg-red-500 disabled:opacity-50 mt-1"
                          >
                            다음 단계
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3">
                          <p className="text-xs font-bold text-gray-800">본인 확인</p>
                          
                          {userProvider === "email" ? (
                            <input
                              type="password"
                              placeholder="계정 비밀번호를 입력해주세요"
                              value={withdrawalPassword}
                              onChange={(e) => setWithdrawalPassword(e.target.value)}
                              className="p-3 text-xs border border-gray-200 rounded-xl bg-gray-50 outline-none"
                            />
                          ) : (
                            <p className="text-[10px] text-gray-500 bg-gray-50 p-3 rounded-xl border border-gray-100">
                              {userProvider} 계정으로 로그인하셨습니다.<br />계속하려면 아래 버튼을 눌러주세요.
                            </p>
                          )}

                          {withdrawalError && <p className="text-[10px] text-red-500">{withdrawalError}</p>}

                          <div className="flex gap-2 mt-2">
                            <button
                              onClick={() => {
                                setWithdrawalStep(1);
                                setWithdrawalError(null);
                              }}
                              className="flex-1 py-2.5 rounded-xl text-gray-600 text-xs font-bold bg-gray-100"
                            >
                              이전
                            </button>
                            <button
                              onClick={handleWithdrawal}
                              disabled={withdrawalLoading || (userProvider === "email" && !withdrawalPassword)}
                              className="flex-1 py-2.5 rounded-xl text-white text-xs font-bold bg-red-500 disabled:opacity-50"
                            >
                              {withdrawalLoading ? "처리 중..." : "탈퇴하기"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* PWA 설치 안내 카드 */}
          <div className="bg-white rounded-2xl px-4 py-4 shadow-sm flex flex-col gap-3 mt-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0" style={{ background: "#f3f4f6" }}>
                📱
              </div>
              {isStandalone ? (
                <div className="flex-1">
                  <p className="text-sm font-bold" style={{ color: "var(--color-k-text-primary)" }}>설치됨</p>
                  <p className="text-[11px]" style={{ color: "#6b7280" }}>이미 앱으로 이용 중이에요</p>
                </div>
              ) : (
                <>
                  <div className="flex-1">
                    <p className="text-sm font-bold" style={{ color: "var(--color-k-text-primary)" }}>앱 설치하기</p>
                    <p className="text-[11px]" style={{ color: "#6b7280" }}>
                      {isIOS ? "공유 버튼 → '홈 화면에 추가'를 눌러주세요" : "홈 화면에 추가하여 더 편리하게 이용하세요"}
                    </p>
                  </div>
                  {!isIOS && installPrompt && (
                    <button
                      onClick={handleInstall}
                      className="px-3 py-1.5 bg-[var(--color-k-navy)] text-white text-xs font-bold rounded-lg shrink-0 active:scale-95 transition-transform"
                    >
                      설치
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* 로그아웃 */}
          <button
            onClick={handleLogout}
            className="w-full py-3.5 rounded-2xl bg-white border border-red-100 text-red-500 text-xs font-bold active:scale-[0.98] transition-transform cursor-pointer shadow-sm mt-3 shrink-0"
          >
            로그아웃
          </button>
        </div>

        <RealParentNav active="설정" />

        {/* 자녀 프로필 수정 모달 — 열려있는 동안 배경 딤 처리로 다른 아이 수정하기 오클릭 방지 */}
        {editChild && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4 sm:pb-0"
            onClick={() => setEditChild(null)}
          >
            <div
              className="w-full max-w-xs bg-white rounded-2xl p-4 shadow-lg flex flex-col gap-3 max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-sm font-bold text-center py-1" style={{ color: "var(--color-k-text-primary)" }}>
                자녀 프로필 수정
              </p>

              {saveErrorSummary && (
                <p className="text-[10px] text-red-500 font-bold text-center -mt-1">{saveErrorSummary}</p>
              )}

              <div className="flex gap-2 items-start">
                <div className="w-1/3">
                  <input
                    ref={familyNameInputRef}
                    type="text"
                    placeholder="성"
                    aria-label="성"
                    value={editFamilyName}
                    onChange={(e) => { setEditFamilyName(e.target.value); if (saveFieldErrors.familyName) setSaveFieldErrors((prev) => ({ ...prev, familyName: undefined })); }}
                    aria-invalid={!!saveFieldErrors.familyName}
                    aria-describedby={saveFieldErrors.familyName ? "edit-family-name-error" : undefined}
                    className={`w-full px-3 py-2 text-xs border rounded-xl bg-gray-50/50 outline-none ${saveFieldErrors.familyName ? "border-red-400" : "border-gray-200"}`}
                  />
                  {saveFieldErrors.familyName && (
                    <p id="edit-family-name-error" className="text-[9px] text-red-500 mt-0.5">{saveFieldErrors.familyName}</p>
                  )}
                </div>
                <div className="w-2/3">
                  <input
                    ref={givenNameInputRef}
                    type="text"
                    placeholder="이름"
                    aria-label="이름"
                    value={editGivenName}
                    onChange={(e) => { setEditGivenName(e.target.value); if (saveFieldErrors.givenName) setSaveFieldErrors((prev) => ({ ...prev, givenName: undefined })); }}
                    aria-invalid={!!saveFieldErrors.givenName}
                    aria-describedby={saveFieldErrors.givenName ? "edit-given-name-error" : undefined}
                    className={`w-full px-3 py-2 text-xs border rounded-xl bg-gray-50/50 outline-none ${saveFieldErrors.givenName ? "border-red-400" : "border-gray-200"}`}
                  />
                  {saveFieldErrors.givenName && (
                    <p id="edit-given-name-error" className="text-[9px] text-red-500 mt-0.5">{saveFieldErrors.givenName}</p>
                  )}
                </div>
              </div>

              <div ref={gradeSectionRef}>
                <p className="text-[9px] text-gray-400 mb-1">학년</p>
                <div className="grid grid-cols-3 gap-1" aria-describedby={saveFieldErrors.grade ? "edit-grade-error" : undefined}>
                  {GRADES.map((g) => (
                    <button
                      key={g}
                      onClick={() => { setEditGrade(g); if (saveFieldErrors.grade) setSaveFieldErrors((prev) => ({ ...prev, grade: undefined })); }}
                      aria-pressed={editGrade === g}
                      className={`py-1.5 text-[9px] font-bold border rounded-lg cursor-pointer ${
                        editGrade === g ? "bg-[var(--color-k-navy)] text-white border-transparent" : "bg-white border-gray-200 text-gray-500"
                      } ${saveFieldErrors.grade ? "border-red-400" : ""}`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                {saveFieldErrors.grade && (
                  <p id="edit-grade-error" className="text-[9px] text-red-500 mt-1">{saveFieldErrors.grade}</p>
                )}
              </div>

              <div ref={interestsSectionRef}>
                <p className="text-[9px] text-gray-400 mb-1">관심사</p>
                <div className="flex flex-wrap gap-1" aria-describedby={saveFieldErrors.interests ? "edit-interests-error" : undefined}>
                  {INTERESTS.map((interest) => {
                    const has = editInterests.includes(interest);
                    return (
                      <button
                        key={interest}
                        onClick={() => toggleInterest(interest, true)}
                        className={`px-2.5 py-1 text-[9px] font-bold border rounded-full cursor-pointer ${
                          has ? "bg-[var(--color-k-orange)] text-white border-transparent" : "bg-white border-gray-200 text-gray-500"
                        } ${saveFieldErrors.interests ? "border-red-400" : ""}`}
                      >
                        {interest}
                      </button>
                    );
                  })}
                </div>
                {saveFieldErrors.interests && (
                  <p id="edit-interests-error" className="text-[9px] text-red-500 mt-1">{saveFieldErrors.interests}</p>
                )}
              </div>

              <div>
                <p className="text-[9px] text-gray-400 mb-1">요금제</p>
                <div className="grid grid-cols-3 gap-1">
                  {CARE_PLANS.map((p) => {
                    const isCurrent = p.tier === editOriginalTier;
                    const isPremiumProd = p.tier === 3; // 053: Care Premium은 모든 환경에서 차단
                    return (
                      <button
                        key={p.tier}
                        onClick={() => handlePlanCardClick(p.tier)}
                        disabled={isCurrent || isPremiumProd || planRequestSubmitting}
                        className={`py-1.5 px-1 text-[9px] font-bold border rounded-lg flex flex-col items-center gap-0.5 ${
                          isCurrent ? "bg-[var(--color-k-navy)] text-white border-transparent" : "bg-white border-gray-200 text-gray-500"
                        } ${isCurrent || isPremiumProd ? "cursor-default" : "cursor-pointer"} disabled:opacity-60`}
                      >
                        <span>{p.label}</span>
                        {isCurrent && <span className="text-[7px] font-normal opacity-80">현재 이용 중</span>}
                        {isPremiumProd && !isCurrent && <span className="text-[7px] font-normal opacity-80 text-gray-400">준비 중</span>}
                      </button>
                    );
                  })}
                </div>
                {planRequestError && (
                  <p className="mt-1.5 text-[9px] text-red-500">{planRequestError}</p>
                )}
              </div>

              {editOriginalTier === 2 && (
                <div className="mt-2 p-3 bg-gray-50 border border-gray-200/60 rounded-xl">
                  <div className="flex justify-between items-center mb-1">
                    <p className="text-[11px] font-bold text-gray-700">Care Insight 확장팩</p>
                    <button
                      type="button"
                      onClick={() => setShowExtensionModal(true)}
                      disabled={extensionYears >= 9}
                      className="px-2 py-1 bg-[var(--color-k-navy)] text-white text-[9px] font-bold rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      1년 연장
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-500">
                    현재 확장: <span className="font-bold text-[var(--color-k-navy)]">+{extensionYears}년</span> (기본 3년)
                  </p>
                  {finalDeletionDate && (
                    <p className="text-[10px] text-gray-500 mt-1">
                      최종 삭제 예정일: {finalDeletionDate.toLocaleDateString()}
                    </p>
                  )}
                  {extensionYears >= 9 && (
                    <p className="text-[9px] text-red-500 mt-1">최대 확장 연수(9년)에 도달했습니다.</p>
                  )}
                </div>
              )}

              {/* 계정 관리 섹션 */}
              <div className="border-t border-gray-150 pt-2.5 mt-1 flex flex-col gap-2">
                <p className="text-[10px] font-bold text-gray-500 px-0.5 text-left">계정 관리</p>
                
                <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-200/60 flex flex-col gap-2">
                  <div className="flex gap-1.5">
                    {/* 계정 확인 버튼 */}
                    <button
                      type="button"
                      disabled={checkingAccount}
                      onClick={async () => {
                        if (!editChild) return;
                        const requestedChildId = editChild.id;
                        setCheckingAccount(true);
                        setAccountError(null);
                        try {
                          const res = await fetch(`/api/child/${requestedChildId}/account`);
                          const data = await res.json();
                          if (editChildIdRef.current !== requestedChildId) return; // 모달이 바뀌었으면 무시
                          if (!res.ok) {
                            setAccountError(data.error || "계정 정보를 불러오지 못했습니다.");
                            setAccountUsername(null);
                          } else {
                            setAccountUsername(data.username);
                          }
                        } catch {
                          if (editChildIdRef.current === requestedChildId) setAccountError("네트워크 에러가 발생했습니다.");
                        } finally {
                          if (editChildIdRef.current === requestedChildId) setCheckingAccount(false);
                        }
                      }}
                      className="flex-1 py-1.5 bg-[#f3f4f6] text-gray-700 text-[10px] font-bold rounded-lg cursor-pointer disabled:opacity-50"
                    >
                      {checkingAccount ? "조회 중..." : "계정 확인"}
                    </button>

                    {/* 비밀번호 초기화 버튼 */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowResetArea(!showResetArea);
                        setAccountError(null);
                      }}
                      className="flex-1 py-1.5 bg-[#f3f4f6] text-gray-700 text-[10px] font-bold rounded-lg cursor-pointer"
                    >
                      비밀번호 초기화
                    </button>
                  </div>

                  {/* 계정 확인 성공 시 username 표시 */}
                  {accountUsername && (
                    <div className="bg-white border border-gray-150 rounded-lg p-2 text-center">
                      <p className="text-[10px] font-medium text-gray-500">로그인 아이디</p>
                      <p className="text-xs font-bold text-gray-800 select-all">{accountUsername}</p>
                    </div>
                  )}

                  {/* 에러 메시지 표시 */}
                  {accountError && (
                    <p className="text-[10px] text-red-500 px-0.5 text-center leading-normal">
                      {accountError}
                    </p>
                  )}

                  {/* 비밀번호 초기화 서브/확장 영역 */}
                  {showResetArea && (
                    <div className="border-t border-gray-200/60 pt-2 mt-1 flex flex-col gap-2">
                      {/* 초기화 성공 결과가 없을 때 입력 폼 노출 */}
                      {!childResetResult ? (
                        <>
                          <div className="flex justify-center gap-4 py-1 text-[10px] font-bold text-gray-600">
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="radio"
                                name="reset_mode"
                                checked={resetPasswordMode === "auto"}
                                onChange={() => setResetPasswordMode("auto")}
                                className="w-3.5 h-3.5 text-[var(--color-k-navy)]"
                              />
                              <span>자동 생성</span>
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="radio"
                                name="reset_mode"
                                checked={resetPasswordMode === "direct"}
                                onChange={() => setResetPasswordMode("direct")}
                                className="w-3.5 h-3.5 text-[var(--color-k-navy)]"
                              />
                              <span>직접 입력</span>
                            </label>
                          </div>

                          {resetPasswordMode === "direct" && (
                            <div className="flex flex-col gap-1.5 text-left">
                              <input
                                type="password"
                                placeholder="새 비밀번호 (6자 이상)"
                                value={newPasswordInput}
                                onChange={(e) => setNewPasswordInput(e.target.value)}
                                className="px-2.5 py-1.5 text-[10px] border border-gray-200 rounded-lg bg-white outline-none"
                              />
                              <input
                                type="password"
                                placeholder="새 비밀번호 확인"
                                value={confirmPasswordInput}
                                onChange={(e) => setConfirmPasswordInput(e.target.value)}
                                className="px-2.5 py-1.5 text-[10px] border border-gray-200 rounded-lg bg-white outline-none"
                              />
                            </div>
                          )}

                          <button
                            type="button"
                            disabled={
                              resettingChildPassword ||
                              (resetPasswordMode === "direct" &&
                                (newPasswordInput.length < 6 || newPasswordInput !== confirmPasswordInput))
                            }
                            onClick={async () => {
                              if (!editChild) return;
                              const requestedChildId = editChild.id;
                              setResettingChildPassword(true);
                              setAccountError(null);
                              try {
                                const body =
                                  resetPasswordMode === "direct"
                                    ? { new_password: newPasswordInput }
                                    : {};
                                const res = await fetch(`/api/child/${requestedChildId}/account/reset-password`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify(body),
                                });
                                const data = await res.json();
                                if (editChildIdRef.current !== requestedChildId) return; // 모달이 바뀌었으면 무시
                                if (!res.ok) {
                                  setAccountError(data.error || "비밀번호 초기화에 실패했습니다.");
                                } else {
                                  setChildResetResult(data);
                                }
                              } catch {
                                if (editChildIdRef.current === requestedChildId) setAccountError("네트워크 에러가 발생했습니다.");
                              } finally {
                                if (editChildIdRef.current === requestedChildId) setResettingChildPassword(false);
                              }
                            }}
                            className="w-full py-1.5 bg-[var(--color-k-navy)] text-white text-[10px] font-bold rounded-lg cursor-pointer disabled:opacity-50"
                          >
                            {resettingChildPassword
                              ? "처리 중..."
                              : resetPasswordMode === "auto"
                              ? "발급받기"
                              : "설정"}
                          </button>
                        </>
                      ) : (
                        /* 초기화 성공 결과 화면 */
                        <div className="bg-white border border-[var(--color-k-orange)]/30 rounded-xl p-3 flex flex-col gap-2">
                          <p className="text-[10px] font-bold text-center text-[var(--color-k-orange)]">
                            비밀번호 초기화 완료
                          </p>
                          <div className="bg-gray-50 rounded-lg p-2 flex flex-col gap-1 text-[10px]">
                            <div className="flex justify-between items-center">
                              <span className="text-gray-500 font-medium">아이디</span>
                              <span className="font-bold text-gray-800">{childResetResult.username}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-gray-500 font-medium">비밀번호</span>
                              <span className="font-bold text-[var(--color-k-orange)]">{childResetResult.password}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const textToCopy = `아이디: ${childResetResult.username} / 비밀번호: ${childResetResult.password}`;
                              navigator.clipboard.writeText(textToCopy);
                              setCopiedChildCreds(true);
                              setTimeout(() => setCopiedChildCreds(false), 2000);
                            }}
                            className="w-full py-1.5 bg-[var(--color-k-orange)] text-white text-[10px] font-bold rounded-lg cursor-pointer flex items-center justify-center gap-1 active:scale-[0.98] transition-transform"
                          >
                            {copiedChildCreds ? "✓ 복사됨" : "📋 계정 정보 복사"}
                          </button>
                          <p className="text-[9px] text-gray-400 text-center leading-normal">
                            이 비밀번호는 지금만 볼 수 있어요.<br />꼭 저장해두세요.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {saveServerError && (
                <p className="text-[10px] text-red-500 font-bold text-center">{saveServerError}</p>
              )}
              {saveState === "success" && (
                <p className="text-[10px] text-green-600 font-bold text-center">자녀 정보가 저장되었어요.</p>
              )}

              <div className="flex gap-2 mt-1">
                <button
                  onClick={async () => {
                    const ok = await commitChildProfileSave();
                    if (ok) {
                      setTimeout(() => setEditChild(null), 900);
                    }
                  }}
                  disabled={saveState === "saving"}
                  className="flex-1 py-2 bg-[var(--color-k-navy)] text-white text-[10px] font-bold rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {saveState === "saving" ? "저장 중..." : "저장"}
                </button>
                <button
                  onClick={() => setEditChild(null)}
                  className="flex-1 py-2 bg-gray-100 text-gray-600 text-[10px] font-bold rounded-lg cursor-pointer"
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        )}

        {showExtensionModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
            <div className="bg-white rounded-2xl p-5 max-w-xs w-full">
              <p className="text-sm font-bold mb-2 text-[var(--color-k-text-primary)]">
                Care Insight 1년 연장
              </p>
              <p className="text-xs leading-relaxed text-gray-500 mb-4">
                <span className="font-bold text-[var(--color-k-navy)]">결제 연동 준비 중입니다. 정식 오픈 후 이용하실 수 있어요.</span><br/><br/>
                현재 선택된 가족의 Care Insight 데이터 보존 기간을 1년 연장하시겠습니까?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    alert("결제 연동 준비 중입니다. 정식 오픈 후 이용 가능합니다");
                    setShowExtensionModal(false);
                  }}
                  className="flex-1 py-2 bg-[var(--color-k-navy)] text-white text-[10px] font-bold rounded-lg cursor-pointer disabled:opacity-50"
                >
                  연장하기
                </button>
                <button
                  disabled={isPurchasingExtension}
                  onClick={() => setShowExtensionModal(false)}
                  className="flex-1 py-2 bg-gray-100 text-gray-600 text-[10px] font-bold rounded-lg cursor-pointer"
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        )}

        {/* §9 요금제 변경 확인 다이얼로그 */}
        {showPlanConfirm && editChild && pendingPlanTier !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" aria-modal="true" role="dialog">
            <div className="bg-white rounded-2xl p-5 max-w-xs w-full">
              <p className="text-sm font-bold mb-2" style={{ color: "var(--color-k-text-primary)" }}>
                {CARE_PLANS.find((p) => p.tier === pendingPlanTier)?.label}로 변경하시겠습니까?
              </p>
              <p className="text-xs leading-relaxed text-gray-500 mb-4">
                {pendingPlanTier === 2 ? (
                  "변경 즉시 Care Insight 기능을 이용할 수 있습니다."
                ) : pendingPlanTier === 1 ? (
                  "변경하면 Care Insight 전용 기능의 이용이 제한될 수 있습니다. 기존에 생성된 데이터는 현재 데이터 보존 정책에 따라 처리됩니다."
                ) : (
                  "변경 즉시 Care Premium 기능을 이용할 수 있습니다."
                )}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    setShowPlanConfirm(false);
                    await requestPlanChange(pendingPlanTier);
                  }}
                  disabled={planRequestSubmitting}
                  className="flex-1 py-2 bg-[var(--color-k-navy)] text-white text-[10px] font-bold rounded-lg cursor-pointer disabled:opacity-50"
                >
                  변경하기
                </button>
                <button
                  onClick={() => { setShowPlanConfirm(false); setPendingPlanTier(null); }}
                  className="flex-1 py-2 bg-gray-100 text-gray-600 text-[10px] font-bold rounded-lg cursor-pointer"
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        )}

        {/* §10 프로필 미저장 변경이 있는 상태에서 요금제를 선택한 경우의 게이트 */}
        {showUnsavedGate && editChild && pendingPlanTier !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
            <div className="bg-white rounded-2xl p-5 max-w-xs w-full">
              <p className="text-sm font-bold mb-2" style={{ color: "var(--color-k-text-primary)" }}>
                수정 중인 자녀 정보가 있어요.
              </p>
              <p className="text-xs leading-relaxed text-gray-500 mb-4">
                자녀 정보를 먼저 저장한 뒤 요금제 변경을 진행해 주세요.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const tier = pendingPlanTier;
                    setShowUnsavedGate(false);
                    const ok = await commitChildProfileSave();
                    if (ok) {
                      await requestPlanChange(tier);
                    }
                  }}
                  disabled={saveState === "saving" || planRequestSubmitting}
                  className="flex-1 py-2 bg-[var(--color-k-navy)] text-white text-[10px] font-bold rounded-lg cursor-pointer disabled:opacity-50"
                >
                  저장하고 진행
                </button>
                <button
                  onClick={() => { setShowUnsavedGate(false); setPendingPlanTier(null); }}
                  className="flex-1 py-2 bg-gray-100 text-gray-600 text-[10px] font-bold rounded-lg cursor-pointer"
                >
                  계속 수정
                </button>
              </div>
            </div>
          </div>
        )}

        {/* §14 요금제 변경 완료 화면 */}
        {showPlanAccepted && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" aria-modal="true" role="dialog">
            <div className="bg-white rounded-2xl p-5 max-w-xs w-full">
              <p className="text-sm font-bold mb-2" style={{ color: "var(--color-k-text-primary)" }}>
                {CARE_PLANS.find((p) => p.tier === showPlanAccepted.requestedTier)?.label}로 변경되었습니다
              </p>
              <p className="text-xs leading-relaxed text-gray-500 mb-3">
                {showPlanAccepted.requestedTier === 2 ? (
                  "새로운 플랜 기능을 지금부터 이용할 수 있습니다."
                ) : showPlanAccepted.requestedTier === 1 ? (
                  "일부 리포트 및 장기 인사이트 기능 이용이 제한될 수 있습니다."
                ) : (
                  "프리미엄 기능이 활성화되었습니다."
                )}
              </p>
              <button
                onClick={() => { setShowPlanAccepted(null); setEditChild(null); }}
                className="w-full py-2 bg-[var(--color-k-navy)] text-white text-[10px] font-bold rounded-lg cursor-pointer"
              >
                확인
              </button>
            </div>
          </div>
        )}
        {/* 법정대리인 동의 철회 확인 모달 — "확인" 전에는 API를 호출하지 않는다(되돌릴 방법이 없는 조작). */}
        {withdrawTarget && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
            onClick={() => !withdrawLoading && setWithdrawTarget(null)}
          >
            <div className="bg-white rounded-2xl p-5 max-w-xs w-full" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm font-bold mb-2" style={{ color: "var(--color-k-text-primary)" }}>
                {withdrawTarget.displayName}의 동의를 철회하시겠어요?
              </p>
              <p className="text-xs leading-relaxed text-gray-500 mb-4">
                철회하면 이 아이의 채팅·미션·리포트·음성 기능이 즉시 모두 막힙니다. 재동의는
                아이 재등록 절차를 다시 거쳐야 하며 이 화면에서 되돌릴 수 없습니다.
              </p>
              {withdrawError && <p className="text-xs text-red-500 mb-3">{withdrawError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleWithdrawConsent}
                  disabled={withdrawLoading}
                  className="flex-1 py-2 bg-red-500 text-white text-[10px] font-bold rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {withdrawLoading ? "철회 중..." : "동의 철회"}
                </button>
                <button
                  onClick={() => setWithdrawTarget(null)}
                  disabled={withdrawLoading}
                  className="flex-1 py-2 bg-gray-100 text-gray-600 text-[10px] font-bold rounded-lg cursor-pointer disabled:opacity-50"
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        )}
        {/* 아이 삭제 확인 모달 — 파괴적 조작 */}
        {deleteChildTarget && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
            onClick={() => !deleteChildLoading && setDeleteChildTarget(null)}
          >
            <div className="bg-white rounded-2xl p-5 max-w-xs w-full" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm font-bold mb-2 text-red-600">
                {deleteChildTarget.displayName}을(를) 정말 삭제하시겠어요?
              </p>
              <p className="text-[11px] leading-relaxed text-gray-500 mb-3">
                이 아이를 삭제하면 아이 계정과 가족 연결이 해제되고 관련 데이터가 삭제 절차에 들어갑니다. 삭제 후에는 복구할 수 없습니다.
              </p>
              <p className="text-[11px] font-bold text-gray-700 mb-1">
                진행하려면 아이 이름 &quot;{deleteChildTarget.displayName}&quot;을(를) 그대로 입력해주세요.
              </p>
              <input
                type="text"
                value={deleteChildConfirmName}
                onChange={(e) => setDeleteChildConfirmName(e.target.value)}
                placeholder="아이 이름 입력"
                className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-xl outline-none mb-3 bg-white text-gray-800"
                disabled={deleteChildLoading}
              />
              {deleteChildError && <p className="text-xs text-red-500 mb-3">{deleteChildError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleDeleteChild}
                  disabled={deleteChildLoading || deleteChildConfirmName.trim() !== deleteChildTarget.displayName.trim()}
                  className="flex-1 py-2 bg-red-600 text-white text-[10px] font-bold rounded-lg cursor-pointer disabled:opacity-50 hover:bg-red-700 transition-colors"
                >
                  {deleteChildLoading ? "삭제 중..." : "삭제"}
                </button>
                <button
                  onClick={() => setDeleteChildTarget(null)}
                  disabled={deleteChildLoading}
                  className="flex-1 py-2 bg-gray-100 text-gray-600 text-[10px] font-bold rounded-lg cursor-pointer disabled:opacity-50 hover:bg-gray-200 transition-colors"
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        )}
        <ChildStartGuideModal
          open={loginGuideChild !== null}
          onClose={() => setLoginGuideChild(null)}
          children={loginGuideChild ? [loginGuideChild] : []}
          initialChildId={loginGuideChild?.id ?? null}
        />
      </div>
    
        <KChatbotWidget appSurface="parent" />
      </DemoFrame>
  );
}
