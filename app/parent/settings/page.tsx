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

function formatRetentionLabel(tier: Tier): string {
  const retention = getEffectiveRetention(tier, 0);
  const months = retention.months;
  return months % 12 === 0 ? `${months / 12}년` : `${months}개월`;
}

const GRADES = ["1학년", "2학년", "3학년", "4학년", "5학년", "6학년"];
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

  // 구성원 추가 폼 상태
  const [inviteEmail, setInviteEmail] = useState("");
  const [addName, setAddName] = useState("");
  const [addUsername, setAddUsername] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addChildGrade, setAddChildGrade] = useState("1학년");
  const [addChildInterests, setAddChildInterests] = useState<string[]>([]);
  const [addChildConsent, setAddChildConsent] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);

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

  const [editName, setEditName] = useState("");
  const [editGrade, setEditGrade] = useState("");
  const [editInterests, setEditInterests] = useState<string[]>([]);
  const [editTier, setEditTier] = useState<number>(1);
  const [editOriginalTier, setEditOriginalTier] = useState<number>(1);
  const [savingTier, setSavingTier] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 요금제 다운그레이드 확인 모달 — "확인" 전에는 어떤 스탬프도 부여하지 않는다(비가역 파기 실수 방지).
  const [showDowngradeConfirm, setShowDowngradeConfirm] = useState(false);

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
  const [activeMenu, setActiveMenu] = useState<"add_child" | "edit_child" | "family_members" | "account_withdrawal" | null>(null);

  // 탈퇴 모달 상태
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

  useEffect(() => {
    loadFamilyMembers();
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

  const commitChildSave = async () => {
    if (!editName.trim() || !editChild) return;
    updateChild(editChild.id, {
      name: editName.trim(),
      grade: editGrade,
      interests: editInterests,
    });
    if (editTier !== editOriginalTier) {
      setSavingTier(true);
      try {
        await fetch(`/api/child/${editChild.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier: editTier }),
        });
      } catch {} finally {
        setSavingTier(false);
      }
    }
    setEditChild(null);
    loadFamilyMembers();
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

    if (!addName.trim()) { setAddError("이름을 입력해주세요."); return; }
    if (!addUsername.trim()) { setAddError("아이디를 입력해주세요."); return; }
    if (addPassword.length < 6) { setAddError("비밀번호는 6자 이상이어야 합니다."); return; }
    if (addChildInterests.length === 0) { setAddError("관심사를 하나 이상 선택해주세요."); return; }
    if (!addChildConsent) { setAddError("법정대리인 동의가 필요합니다."); return; }

    setAddLoading(true);
    try {
      const body = {
        username: addUsername.trim(),
        password: addPassword,
        name: addName.trim(),
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
        setAddError(data.error || "아이 추가에 실패했습니다.");
        return;
      }

      setAddName("");
      setAddUsername("");
      setAddPassword("");
      setAddChildInterests([]);
      setAddChildConsent(false);
      setActiveMenu(null);
      await loadFamilyMembers();
      
      const { syncChildrenFromDB } = await import("@/lib/store");
      await syncChildrenFromDB();
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

  const menuToggle = (menu: "add_child" | "edit_child" | "family_members" | "account_withdrawal") => {
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
            onClick={() => menuToggle("add_child")}
            className="bg-white rounded-2xl px-4 py-4 shadow-sm flex flex-col gap-3 cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0" style={{ background: "#f3f4f6" }}>
                ➕
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: "#1e1e2d" }}>아이 추가</p>
                <p className="text-[11px]" style={{ color: "#6b7280" }}>새로운 아이 계정을 추가해요</p>
              </div>
              <span className="text-sm" style={{ color: "#6b7280", transform: activeMenu === "add_child" ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>→</span>
            </div>

            {activeMenu === "add_child" && (
              <div className="pt-3 border-t border-gray-100" onClick={(e) => e.stopPropagation()}>
                {isOwner ? (
                  <form onSubmit={handleAddChild} className="flex flex-col gap-3">
                    <input
                      type="text"
                      placeholder="아이 이름"
                      value={addName}
                      onChange={(e) => setAddName(e.target.value)}
                      className="px-3.5 py-2 text-xs border border-gray-200 rounded-xl outline-none bg-gray-50/50"
                    />
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
                      <p className="text-[10px] font-bold text-gray-500 mb-1 px-1">학년 선택</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {GRADES.map((g) => (
                          <button
                            key={g}
                            type="button"
                            onClick={() => setAddChildGrade(g)}
                            className={`py-1.5 text-[10px] font-bold rounded-xl border ${
                              addChildGrade === g ? "bg-[#1a6b5a] text-white border-transparent" : "bg-white border-gray-200 text-gray-600"
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
                                has ? "bg-[#e8845a] text-white border-transparent" : "bg-white border-gray-200 text-gray-600"
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
                        className="w-4 h-4 rounded text-[#1a6b5a]"
                      />
                      <span className="text-[10px] font-bold text-gray-500">위 내용을 확인했으며, 법정대리인으로서 개인정보 수집·이용에 동의합니다</span>
                    </label>

                    {addError && <p className="text-xs text-red-500 px-1">{addError}</p>}
                    <button
                      type="submit"
                      disabled={addLoading}
                      className="w-full py-2.5 rounded-xl text-white text-xs font-bold active:scale-95 transition-transform md:scroll-mb-[calc(7rem+env(safe-area-inset-bottom,0px))]"
                      style={{ background: "#1a6b5a" }}
                    >
                      {addLoading ? "아이 추가 중..." : "자녀 등록 완료"}
                    </button>
                  </form>
                ) : (
                  <p className="text-[10px] text-gray-400 text-center py-2">가족 오너 권한이 있는 보호자만 아이를 등록할 수 있습니다.</p>
                )}
              </div>
            )}
          </div>

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
                <p className="text-sm font-bold" style={{ color: "#1e1e2d" }}>아이 정보 관리</p>
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
                                    setEditName(m.displayName);
                                    setEditGrade(m.grade);
                                    setEditInterests(m.interests ?? []);
                                    setEditTier(m.tier ?? 1);
                                    setEditOriginalTier(m.tier ?? 1);
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
                              {/* Block 3: 아이 삭제 (모바일 전체 너비 w-full 독립 블록) */}
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
                <p className="text-sm font-bold" style={{ color: "#1e1e2d" }}>보호자 설정</p>
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
                      className="px-4 py-1.5 bg-[#1a6b5a] text-white text-xs font-bold rounded-xl disabled:opacity-50 cursor-pointer active:scale-95 transition-transform"
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
                        onChange={(e) => setNotifSetting("reportAlert", e.target.checked)}
                        className="w-4 h-4 rounded text-[#1a6b5a]"
                      />
                    </label>
                    <label className="flex items-center justify-between text-xs cursor-pointer">
                      <div>
                        <p className="font-bold text-gray-800">주간 종합 요약 알림</p>
                        <p className="text-[10px] text-gray-400">매주 일요일 자녀의 주간 종합 분석 알림</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={weeklySummary}
                        onChange={(e) => setNotifSetting("weeklySummary", e.target.checked)}
                        className="w-4 h-4 rounded text-[#1a6b5a]"
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
                            className="px-4 py-1.5 bg-[#1a6b5a] text-white text-xs font-bold rounded-xl active:scale-95 transition-transform"
                          >
                            초대
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* PWA 설치 안내 카드 */}
          {!isStandalone && (
            <div className="bg-white rounded-2xl px-4 py-4 shadow-sm flex flex-col gap-3 mt-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0" style={{ background: "#f3f4f6" }}>
                  📱
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold" style={{ color: "#1e1e2d" }}>앱 설치하기</p>
                  <p className="text-[11px]" style={{ color: "#6b7280" }}>
                    {isIOS ? "공유 버튼 → '홈 화면에 추가'를 눌러주세요" : "홈 화면에 추가하여 더 편리하게 이용하세요"}
                  </p>
                </div>
                {!isIOS && installPrompt && (
                  <button
                    onClick={handleInstall}
                    className="px-3 py-1.5 bg-[#1a6b5a] text-white text-xs font-bold rounded-lg shrink-0 active:scale-95 transition-transform"
                  >
                    설치
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 4. 회원 탈퇴 메뉴 카드 */}
          <div
            onClick={() => menuToggle("account_withdrawal")}
            className="bg-white rounded-2xl px-4 py-4 shadow-sm flex flex-col gap-3 cursor-pointer mt-3"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0" style={{ background: "#f3f4f6" }}>
                🚪
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-red-500">회원 탈퇴</p>
                <p className="text-[11px]" style={{ color: "#6b7280" }}>계정과 모든 데이터를 삭제합니다</p>
              </div>
              <span className="text-sm" style={{ color: "#6b7280", transform: activeMenu === "account_withdrawal" ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>→</span>
            </div>

            {activeMenu === "account_withdrawal" && (
              <div className="pt-3 border-t border-gray-100 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
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
              <p className="text-sm font-bold text-center py-1" style={{ color: "#1e1e2d" }}>
                자녀 프로필 수정
              </p>

              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="px-3 py-2 text-xs border border-gray-200 rounded-xl bg-gray-50/50 outline-none"
              />

              <div>
                <p className="text-[9px] text-gray-400 mb-1">학년</p>
                <div className="grid grid-cols-3 gap-1">
                  {GRADES.map((g) => (
                    <button
                      key={g}
                      onClick={() => setEditGrade(g)}
                      className={`py-1.5 text-[9px] font-bold border rounded-lg cursor-pointer ${
                        editGrade === g ? "bg-[#1a6b5a] text-white border-transparent" : "bg-white border-gray-200 text-gray-500"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[9px] text-gray-400 mb-1">관심사</p>
                <div className="flex flex-wrap gap-1">
                  {INTERESTS.map((interest) => {
                    const has = editInterests.includes(interest);
                    return (
                      <button
                        key={interest}
                        onClick={() => toggleInterest(interest, true)}
                        className={`px-2.5 py-1 text-[9px] font-bold border rounded-full cursor-pointer ${
                          has ? "bg-[#e8845a] text-white border-transparent" : "bg-white border-gray-200 text-gray-500"
                        }`}
                      >
                        {interest}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-[9px] text-gray-400 mb-1">요금제</p>
                <div className="grid grid-cols-3 gap-1">
                  {CARE_PLANS.map((p) => (
                    <button
                      key={p.tier}
                      onClick={() => setEditTier(p.tier)}
                      className={`py-1.5 text-[9px] font-bold border rounded-lg cursor-pointer ${
                        editTier === p.tier ? "bg-[#1a6b5a] text-white border-transparent" : "bg-white border-gray-200 text-gray-500"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {editTier === 2 && (
                <div className="mt-2 p-3 bg-gray-50 border border-gray-200/60 rounded-xl">
                  <div className="flex justify-between items-center mb-1">
                    <p className="text-[11px] font-bold text-gray-700">Care Insight 확장팩</p>
                    <button
                      type="button"
                      onClick={() => setShowExtensionModal(true)}
                      disabled={extensionYears >= 9}
                      className="px-2 py-1 bg-[#1a6b5a] text-white text-[9px] font-bold rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      1년 연장
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-500">
                    현재 확장: <span className="font-bold text-[#1a6b5a]">+{extensionYears}년</span> (기본 3년)
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
                                className="w-3.5 h-3.5 text-[#1a6b5a]"
                              />
                              <span>자동 생성</span>
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="radio"
                                name="reset_mode"
                                checked={resetPasswordMode === "direct"}
                                onChange={() => setResetPasswordMode("direct")}
                                className="w-3.5 h-3.5 text-[#1a6b5a]"
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
                            className="w-full py-1.5 bg-[#1a6b5a] text-white text-[10px] font-bold rounded-lg cursor-pointer disabled:opacity-50"
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
                        <div className="bg-white border border-[#e8845a]/30 rounded-xl p-3 flex flex-col gap-2">
                          <p className="text-[10px] font-bold text-center text-[#e8845a]">
                            비밀번호 초기화 완료
                          </p>
                          <div className="bg-gray-50 rounded-lg p-2 flex flex-col gap-1 text-[10px]">
                            <div className="flex justify-between items-center">
                              <span className="text-gray-500 font-medium">아이디</span>
                              <span className="font-bold text-gray-800">{childResetResult.username}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-gray-500 font-medium">비밀번호</span>
                              <span className="font-bold text-[#e8845a]">{childResetResult.password}</span>
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
                            className="w-full py-1.5 bg-[#e8845a] text-white text-[10px] font-bold rounded-lg cursor-pointer flex items-center justify-center gap-1 active:scale-[0.98] transition-transform"
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

              <div className="flex gap-2 mt-1">
                <button
                  onClick={async () => {
                    if (!editName.trim() || !editChild) return;
                    // 다운그레이드(요금제 하향)면 저장 직전 확인 모달을 먼저 띄운다 — "확인"을
                    // 누르기 전까지는 이름/관심사 등 다른 항목도 포함해 어떤 변경도 커밋하지 않는다.
                    if (editTier < editOriginalTier) {
                      setShowDowngradeConfirm(true);
                      return;
                    }
                    await commitChildSave();
                  }}
                  disabled={savingTier}
                  className="flex-1 py-2 bg-[#1a6b5a] text-white text-[10px] font-bold rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {savingTier ? "저장중" : "저장"}
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
              <p className="text-sm font-bold mb-2 text-[#1e1e2d]">
                Care Insight 1년 연장
              </p>
              <p className="text-xs leading-relaxed text-gray-500 mb-4">
                <span className="font-bold text-[#1a6b5a]">결제 연동 준비 중입니다. 정식 오픈 후 이용하실 수 있어요.</span><br/><br/>
                현재 선택된 가족의 Care Insight 데이터 보존 기간을 1년 연장하시겠습니까?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    alert("결제 연동 준비 중입니다. 정식 오픈 후 이용 가능합니다");
                    setShowExtensionModal(false);
                  }}
                  className="flex-1 py-2 bg-[#1a6b5a] text-white text-[10px] font-bold rounded-lg cursor-pointer disabled:opacity-50"
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

        {showDowngradeConfirm && editChild && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
            <div className="bg-white rounded-2xl p-5 max-w-xs w-full">
              <p className="text-sm font-bold mb-2" style={{ color: "#1e1e2d" }}>
                요금제를 낮추시겠어요?
              </p>
              <p className="text-xs leading-relaxed text-gray-500 mb-4">
                {formatRetentionLabel(editTier as Tier)} 초과 데이터는 1개월 후 완전 파기됩니다. 1개월 안에 다시
                요금제를 올리면 데이터를 복구할 수 있어요.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    setShowDowngradeConfirm(false);
                    await commitChildSave();
                  }}
                  disabled={savingTier}
                  className="flex-1 py-2 bg-[#1a6b5a] text-white text-[10px] font-bold rounded-lg cursor-pointer disabled:opacity-50"
                >
                  확인
                </button>
                <button
                  onClick={() => setShowDowngradeConfirm(false)}
                  className="flex-1 py-2 bg-gray-100 text-gray-600 text-[10px] font-bold rounded-lg cursor-pointer"
                >
                  취소
                </button>
              </div>
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
              <p className="text-sm font-bold mb-2" style={{ color: "#1e1e2d" }}>
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
      </div>
    </DemoFrame>
  );
}
