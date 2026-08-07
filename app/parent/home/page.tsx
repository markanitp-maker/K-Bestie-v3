"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "@/hooks/useStore";
import { createClient } from "@/lib/supabase/client";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealParentNav } from "@/components/RealParentNav";
import { ParentHomeHeader } from "./components/ParentHomeHeader";
import { useDemoView } from "@/app/demo/components/DemoViewContext";
import { SkeletonBox } from "@/components/Skeleton";
import KChatbotWidget from "@/components/KChatbotWidget";
import { TodayConversationGuide } from "./components/TodayConversationGuide";
import { InsightGrid } from "./components/InsightGrid";
import AppEventAnnouncementModal from "@/components/events/AppEventAnnouncementModal";
import { ParentMissionEventStatus } from "@/components/events/ParentMissionEventStatus";
import { NotificationOnboarding } from "@/components/notifications/NotificationOnboarding";

interface Report {
  id: string;
  summary_line: string;
  mood_score: number;
  emotion_tags: string[];
  parent_guide: string;
  emotion_level: "safe" | "warning" | "danger" | null;
  school_academy_life?: string;
  peer_friendship?: string;
  emotion_hint?: string;
  interests_preferences?: string;
  study_concerns?: string;
  digital_content_interests?: string;
  teacher_adults?: string;
  recurring_stories?: string;
  business_date?: string;
  created_at: string;
}

export default function ParentHomePage() {
  const router = useRouter();
  const { view } = useDemoView();
  const store = useStore();
  const children = store.children;

  const [mounted, setMounted] = useState(false);
  // 로그인 직후 로컬 캐시(activeFamilyId)가 DB 상태와 동기화되기 전까지 온보딩 화면이
  // 먼저 그려지는 것을 막기 위한 게이트. syncChildrenFromDB()가 끝나야 false가 된다.
  const [syncingFamily, setSyncingFamily] = useState(true);
  const [parentName, setParentName] = useState<string>("보호자");
  const [latestReport, setLatestReport] = useState<Report | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<{ status: number; message: string } | null>(null);
  const [insightsData, setInsightsData] = useState<any>(null);
  const [todaysQuote, setTodaysQuote] = useState<string | null>(null);

  // 가족 초대 팝업 관련 상태
  const [pendingInvite, setPendingInvite] = useState<{ id: string; familyName: string; inviterName: string } | null>(null);
  const [currentFamily, setCurrentFamily] = useState<{ id: string; name: string; hasChildren: boolean; otherGuardianCount: number } | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [agreeTransition, setAgreeTransition] = useState(false);
  const [invitePopupLoading, setInvitePopupLoading] = useState(true);
  const [inviteActionLoading, setInviteActionLoading] = useState(false);
  const [inviteActionError, setInviteActionError] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCurrentUserEmail(user?.email?.trim().toLowerCase() ?? "");
    });

    const checkPendingInvite = async () => {
      try {
        setInvitePopupLoading(true);
        const res = await fetch("/api/families/pending-invite");
        if (res.ok) {
          const data = await res.json();
          if (data?.invite) {
            setPendingInvite({
              id: data.invite.id,
              familyName: data.invite.familyName,
              inviterName: data.invite.inviterName,
            });
            setCurrentFamily(data.currentFamily ?? null);
          } else {
            setPendingInvite(null);
            setCurrentFamily(null);
          }
        }
      } catch (err) {
        console.error("Failed to check pending invite:", err);
      } finally {
        setInvitePopupLoading(false);
      }
    };
    checkPendingInvite();
  }, []);

  const handleConfirmAcceptInvite = async () => {
    if (!pendingInvite) return;
    setInviteActionLoading(true);
    setInviteActionError(null);
    try {
      const res = await fetch(`/api/families/pending-invite/${pendingInvite.id}/accept`, {
        method: "POST"
      });
      if (res.ok) {
        setShowConfirmModal(false);
        setPendingInvite(null);
        setAgreeTransition(false);
        const { syncChildrenFromDB } = await import("@/lib/store");
        await syncChildrenFromDB();
      } else {
        const data = await res.json();
        setInviteActionError(data.error || "초대 수락에 실패했습니다.");
      }
    } catch {
      setInviteActionError("네트워크 에러가 발생했습니다.");
    } finally {
      setInviteActionLoading(false);
    }
  };

  const handleDeclinePendingInvite = async () => {
    if (!pendingInvite) return;
    setInviteActionLoading(true);
    setInviteActionError(null);
    try {
      const res = await fetch(`/api/families/pending-invite/${pendingInvite.id}/decline`, {
        method: "POST"
      });
      if (res.ok) {
        setPendingInvite(null);
      } else {
        const data = await res.json();
        setInviteActionError(data.error || "초대 거절에 실패했습니다.");
      }
    } catch {
      setInviteActionError("네트워크 에러가 발생했습니다.");
    } finally {
      setInviteActionLoading(false);
    }
  };

  const renderInvitePopup = (suppressInitialPrompt = false) => {
    if (!pendingInvite) return null;

    // 충돌 상태 계산 (다른 보호자가 있는 기존 가족 소속인 경우)
    const isConflict = currentFamily !== null && currentFamily.otherGuardianCount > 0;

    return (
      <>
        {/* 1단계: 초대 팝업 */}
        {!suppressInitialPrompt && !showConfirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl flex flex-col gap-4 text-center">
              <div>
                <p className="text-3xl mb-2">✉️</p>
                <h3 className="text-base font-bold text-gray-800">다른 가족 구성원이 초대하였습니다</h3>
                <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                  <span className="font-bold text-gray-800">{pendingInvite.familyName}</span> 가족의{" "}
                  <span className="font-bold text-gray-800">{pendingInvite.inviterName}</span>님이 보호자로 초대했어요.
                </p>
              </div>

              {inviteActionError && (
                <p className="text-xs font-semibold text-red-500">{inviteActionError}</p>
              )}

              {isConflict && (
                <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-xl p-3 leading-relaxed text-left">
                  현재 가족에 다른 보호자가 있어 이 초대를 자동으로 수락할 수 없습니다. 고객센터에 문의해주세요.
                </p>
              )}

              <div className="flex flex-col gap-2 mt-2">
                {isConflict ? (
                  <button
                    disabled
                    className="w-full py-3 rounded-xl font-bold text-white text-sm bg-gray-300 cursor-not-allowed"
                  >
                    수락 불가
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setInviteActionError(null);
                      setAgreeTransition(false);
                      setShowConfirmModal(true);
                    }}
                    disabled={inviteActionLoading}
                    className="w-full py-3 rounded-xl font-bold text-white text-sm disabled:opacity-50 cursor-pointer active:scale-[0.98] transition-transform"
                    style={{ background: "var(--color-k-navy)" }}
                  >
                    수락
                  </button>
                )}
                <button
                  onClick={handleDeclinePendingInvite}
                  disabled={inviteActionLoading}
                  className="w-full py-3 rounded-xl font-bold text-sm bg-red-50 text-red-600 border border-red-100 disabled:opacity-50 cursor-pointer active:scale-[0.98] transition-transform"
                >
                  {inviteActionLoading ? "처리 중..." : "거절"}
                </button>
                <button
                  onClick={() => setPendingInvite(null)}
                  disabled={inviteActionLoading}
                  className="w-full py-3 rounded-xl font-bold text-sm bg-white border border-gray-200 text-gray-500 disabled:opacity-50 cursor-pointer active:scale-[0.98] transition-transform"
                >
                  나중에
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 2단계: 파괴적 변경 확인 모달 */}
        {showConfirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" style={{ zIndex: 60 }}>
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl flex flex-col gap-4 text-center">
              <div>
                <p className="text-3xl mb-2">⚠️</p>
                <h3 className="text-base font-bold text-gray-800">가족 전환 확인</h3>
                
                {currentFamily === null ? (
                  <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                    초대한 가족의 구성원으로 참여합니다.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs text-red-500 mt-2 leading-relaxed font-medium">
                      현재 가족과 등록된 아이 및 데이터가 초대한 가족으로 이전되어 하나의 가족으로 합쳐집니다. 기존 가족은 전환 후 사라집니다.
                    </p>
                    <label className="flex items-start gap-2 text-left bg-gray-50 p-3 rounded-xl border border-gray-100 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={agreeTransition}
                        onChange={(e) => setAgreeTransition(e.target.checked)}
                        className="mt-1 cursor-pointer w-4 h-4 accent-k-navy"
                      />
                      <span className="text-[11px] text-gray-600 leading-tight">
                        기존 가족이 삭제되고 초대한 가족으로 전환되는 것에 동의합니다.
                      </span>
                    </label>
                  </div>
                )}
              </div>

              {inviteActionError && (
                <p className="text-xs font-semibold text-red-500">{inviteActionError}</p>
              )}

              <div className="flex flex-col gap-2 mt-2">
                <button
                  onClick={handleConfirmAcceptInvite}
                  disabled={inviteActionLoading || (currentFamily !== null && !agreeTransition)}
                  className="w-full py-3 rounded-xl font-bold text-white text-sm disabled:opacity-50 cursor-pointer active:scale-[0.98] transition-transform"
                  style={{ background: "var(--color-k-navy)" }}
                >
                  {inviteActionLoading ? "처리 중..." : (currentFamily === null ? "참여하기" : "초대 수락 및 가족 전환")}
                </button>
                <button
                  onClick={() => {
                    setShowConfirmModal(false);
                    setInviteActionError(null);
                  }}
                  disabled={inviteActionLoading}
                  className="w-full py-3 rounded-xl font-bold text-sm bg-white border border-gray-200 text-gray-500 disabled:opacity-50 cursor-pointer active:scale-[0.98] transition-transform"
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  // 가족 관리 상태
  const [famName, setFamName] = useState("");
  const [creatingFam, setCreatingFam] = useState(false);
  const [viewState, setViewState] = useState<"select" | "create_family" | "join_family">("select");
  const [incomingRequests, setIncomingRequests] = useState<any[]>([]);

  const activeChild = children.find((c) => c.id === store.activeChildId) ?? children[0] ?? null;

  const loadIncomingRequests = async () => {
    if (store.activeFamilyId) return;
    try {
      const res = await fetch("/api/family-join-requests/incoming");
      if (res.ok) {
        const data = await res.json();
        setIncomingRequests(data.invites ?? []);
      }
    } catch {}
  };

  const handleAcceptInvite = async (requestId: string) => {
    try {
      const res = await fetch(`/api/family-join-requests/${requestId}/accept`, {
        method: "POST"
      });
      if (res.ok) {
        const { syncChildrenFromDB } = await import("@/lib/store");
        await syncChildrenFromDB();
      } else {
        const data = await res.json();
        alert(data.error || "초대 수락에 실패했습니다.");
      }
    } catch {
      alert("네트워크 에러가 발생했습니다.");
    }
  };

  const handleDeclineInvite = async (requestId: string) => {
    try {
      const res = await fetch(`/api/family-join-requests/${requestId}/decline`, {
        method: "POST"
      });
      if (res.ok) {
        await loadIncomingRequests();
      } else {
        const data = await res.json();
        alert(data.error || "초대 거절에 실패했습니다.");
      }
    } catch {
      alert("네트워크 에러가 발생했습니다.");
    }
  };

  useEffect(() => {
    setMounted(true);

    // 가입 미완료 계정이 온보딩 완료 전 /parent/home으로 진입하는 것을 방지
    fetch("/api/auth/membership-status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((status) => {
        if (status?.state === "AUTHENTICATED_INCOMPLETE") {
          window.location.replace(`/signup?step=${status.onboardingStep ?? "consent"}`);
        } else if (status?.state === "RESTOREABLE_WITHDRAWN") {
          window.location.replace("/account/withdrawn");
        }
      })
      .catch(() => {});

    fetch("/api/parents/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.parent?.name) {
          setParentName(data.parent.name);
        }
      })
      .catch(() => {});

    // 마운트 시 항상 먼저 DB 스토어를 동기화한다.
    (async () => {
      try {
        const { syncChildrenFromDB } = await import("@/lib/store");
        await syncChildrenFromDB();
      } finally {
        setSyncingFamily(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (mounted && !store.activeFamilyId) {
      loadIncomingRequests();
    }
  }, [mounted, store.activeFamilyId]);

  const fetchSeqRef = useRef<number>(0);

  const fetchReports = useCallback(() => {
    if (!activeChild) {
      setLatestReport(null);
      setInsightsData(null);
      setTodaysQuote(null);
      setReportError(null);
      return;
    }
    const seq = ++fetchSeqRef.current;
    
    setReportLoading(true);
    setReportError(null);

    fetch(`/api/parent/reports?childId=${encodeURIComponent(activeChild.id)}`)
      .then(async (r) => {
        if (!r.ok) {
           let errData = {};
           try { errData = await r.json(); } catch {}
           throw { status: r.status, message: (errData as any).error || "Failed" };
        }
        return r.json();
      })
      .then((data) => {
        if (fetchSeqRef.current !== seq) return;
        if (data.childId && data.childId !== activeChild.id) return;
        
        const reports: Report[] = data?.reports ?? [];
        if (reports.length > 0) {
          setLatestReport(reports[0]);
        } else {
          setLatestReport(null);
        }
        setInsightsData(data?.insights ?? null);
        setTodaysQuote(data?.todaysQuote ?? null);
      })
      .catch((err) => {
        if (fetchSeqRef.current !== seq) return;
        setLatestReport(null);
        setInsightsData(null);
        setTodaysQuote(null);
        if (err.status) {
          setReportError({ status: err.status, message: err.message || "Network Error" });
        } else {
          setReportError({ status: 0, message: "Network Disconnected" });
        }
      })
      .finally(() => {
        if (fetchSeqRef.current === seq) {
          setReportLoading(false);
        }
      });
  }, [activeChild]);

  useEffect(() => {
    fetchReports();
    return () => {
      fetchSeqRef.current += 1;
    };
  }, [fetchReports]);

  if (!mounted || syncingFamily) {
    return (
      <DemoFrame>
        <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--color-k-background)" }}>
          <ParentHomeHeader />
          <NotificationOnboarding role="parent" />
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-8">
            <SkeletonBox className="w-28 h-5 mb-3" />
            <div className={`grid ${view === "tablet" ? "grid-cols-4" : "grid-cols-2"} gap-3`}>
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonBox key={i} className="h-24" />
              ))}
            </div>
          </div>
          <div className="h-16 shrink-0 border-t border-k-border" />
        </div>
      </DemoFrame>
    );
  }

  // 가족 만들기 / 참여하기 분기 렌더링
  if (!store.activeFamilyId) {
    return (
      <DemoFrame>
        <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--color-k-background)" }}>
          <ParentHomeHeader />
          <NotificationOnboarding role="parent" />

          {viewState === "select" && (
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-10 flex flex-col items-center text-center gap-6">
              <p className="text-5xl">🏡</p>
              <div>
                <p className="text-base font-bold text-gray-800">반가워요! 어떻게 시작할까요?</p>
                <p className="text-xs mt-1.5 leading-relaxed text-gray-500">
                  가족을 새로 만들거나, 이미 만들어진 가족에 참여할 수 있습니다.
                </p>
              </div>

              {incomingRequests.length > 0 && (
                <div className="w-full text-left bg-white rounded-2xl p-4 border border-indigo-100 shadow-sm flex flex-col gap-2.5 mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg">✉️</span>
                    <p className="text-xs font-bold text-gray-900">내 앞으로 온 가족 초대</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    {incomingRequests.map((req) => (
                      <div key={req.id} className="bg-indigo-50/30 rounded-xl p-3 border border-indigo-50 flex items-center justify-between gap-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-gray-800 truncate">
                            {req.family_name ? `${req.family_name}에 초대됨` : "가족에 초대받음"}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-0.5 truncate">보낸이: {req.invited_by_email}</p>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleAcceptInvite(req.id)}
                            className="px-2 py-1 bg-k-navy text-white rounded-lg text-[11px] font-bold cursor-pointer active:scale-95"
                          >
                            수락
                          </button>
                          <button
                            onClick={() => handleDeclineInvite(req.id)}
                            className="px-2 py-1 bg-white border border-gray-200 text-gray-600 rounded-lg text-[11px] font-bold cursor-pointer active:scale-95"
                          >
                            거절
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="w-full max-w-xs flex flex-col gap-5 mt-2">
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setViewState("create_family")}
                    className="w-full py-4 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform text-center cursor-pointer"
                    style={{ background: "var(--color-k-navy)" }}
                  >
                    가족 만들기
                  </button>
                  <p className="px-1 text-xs leading-relaxed text-gray-500">
                    베타 신청 시 등록한 이메일로 가입하셨다면, 새 가족을 만들어 주세요
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setViewState("join_family")}
                    className="w-full py-4 rounded-2xl font-bold text-sm bg-white border border-gray-200 text-gray-700 active:scale-[0.98] transition-transform text-center cursor-pointer"
                  >
                    가족 구성원으로 참여하기
                  </button>
                  <p className="px-1 text-xs leading-relaxed text-gray-500">
                    이미 만들어진 가족이 있다면, 보호자로 참여합니다.
                  </p>
                </div>
              </div>
            </div>
          )}

          {viewState === "create_family" && (
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-14 flex flex-col items-center text-center gap-6">
              <p className="text-5xl">🛠️</p>
              <div>
                <p className="text-base font-bold text-gray-800">새로운 가족 만들기</p>
                <p className="text-xs mt-1.5 leading-relaxed text-gray-500">
                  가족 그룹을 만들고 아이를 등록해 보세요.
                </p>
              </div>
              <form onSubmit={async (e) => {
                e.preventDefault();
                if (!famName.trim()) return;
                setCreatingFam(true);
                try {
                  const res = await fetch("/api/families", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: famName.trim() }),
                  });
                  if (res.ok) {
                    const { syncChildrenFromDB } = await import("@/lib/store");
                    await syncChildrenFromDB();
                    router.push("/parent/settings?open=add-child");
                  }
                } catch {} finally {
                  setCreatingFam(false);
                }
              }} className="w-full max-w-xs flex flex-col gap-3">
                <input
                  type="text"
                  placeholder="예) 서준이네 가족"
                  value={famName}
                  onChange={(e) => setFamName(e.target.value)}
                  className="w-full rounded-2xl px-4 py-3.5 text-sm border border-gray-200 outline-none bg-white text-center"
                />
                <button
                  type="submit"
                  disabled={creatingFam || !famName.trim()}
                  className="w-full py-3.5 rounded-2xl font-bold text-white text-sm disabled:opacity-50 active:scale-[0.98] transition-transform cursor-pointer"
                  style={{ background: "var(--color-k-navy)" }}
                >
                  {creatingFam ? "가족 만드는 중..." : "가족 만들기 →"}
                </button>
                <button
                  type="button"
                  onClick={() => setViewState("select")}
                  className="text-xs font-semibold text-gray-500 hover:underline mt-2 cursor-pointer"
                >
                  뒤로 가기
                </button>
              </form>
            </div>
          )}

          {viewState === "join_family" && (
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-14 flex flex-col items-center text-center gap-6">
              <p className="text-5xl">🤝</p>
              <div>
                <p className="text-base font-bold text-gray-800">가족 구성원으로 참여하기</p>
                <p className="text-xs mt-1.5 leading-relaxed text-gray-500">
                  기존 가족 구성원에게 아래 이메일로 초대를 요청해 주세요.
                </p>
              </div>
              <div className="w-full max-w-xs flex flex-col gap-3">
                <div className="w-full rounded-2xl px-4 py-3.5 border border-gray-200 bg-white text-center">
                  <p className="text-[11px] font-semibold text-gray-400 mb-1">내 로그인 이메일</p>
                  <p className="text-sm font-bold text-gray-800 break-all">
                    {currentUserEmail || "이메일을 확인하고 있어요..."}
                  </p>
                </div>

                {invitePopupLoading ? (
                  <div className="rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-4">
                    <p className="text-xs font-semibold text-gray-600">도착한 초대를 확인하고 있어요...</p>
                  </div>
                ) : pendingInvite ? (
                  <div className="rounded-2xl border border-sky-100 bg-white px-4 py-4 text-left shadow-sm">
                    <p className="text-sm font-bold text-gray-800">
                      {pendingInvite.familyName} 가족에서 초대가 왔어요
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {pendingInvite.inviterName}님이 보호자로 초대했습니다.
                    </p>
                    {inviteActionError && (
                      <p className="text-xs font-semibold text-red-500 mt-2">{inviteActionError}</p>
                    )}
                    <div className="grid grid-cols-2 gap-2 mt-4">
                      <button
                        type="button"
                        onClick={() => {
                          setInviteActionError(null);
                          setAgreeTransition(false);
                          setShowConfirmModal(true);
                        }}
                        disabled={inviteActionLoading}
                        className="py-3 rounded-xl font-bold text-white text-sm disabled:opacity-50"
                        style={{ background: "var(--color-k-navy)" }}
                      >
                        수락
                      </button>
                      <button
                        type="button"
                        onClick={handleDeclinePendingInvite}
                        disabled={inviteActionLoading}
                        className="py-3 rounded-xl font-bold text-sm bg-white border border-gray-200 text-gray-600 disabled:opacity-50"
                      >
                        {inviteActionLoading ? "처리 중..." : "거절"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-4">
                    <p className="text-sm font-bold text-gray-800">아직 도착한 초대가 없어요</p>
                    <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                      가족 대표가 보호자를 추가한 뒤, 새로 고침을 하면 초대장을 확인하실 수 있어요.
                    </p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setViewState("select")}
                  className="text-xs font-semibold text-gray-500 hover:underline mt-2 cursor-pointer"
                >
                  뒤로 가기
                </button>
              </div>
            </div>
          )}
        </div>
        {renderInvitePopup(viewState === "join_family")}
      </DemoFrame>
    );
  }

  // 아이가 아예 등록되어 있지 않은 경우
  if (children.length === 0) {
    return (
      <DemoFrame>
        <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--color-k-background)" }}>
          <ParentHomeHeader />
          <NotificationOnboarding role="parent" />
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-14 flex flex-col items-center text-center gap-6">
            <p className="text-5xl">🧒</p>
            <div>
              <p className="text-base font-bold text-gray-800">아직 등록된 아이가 없어요</p>
              <p className="text-xs mt-1.5 leading-relaxed text-gray-500">
                설정 메뉴나 온보딩을 통해 자녀를 먼저 등록해 보세요.
              </p>
            </div>
            <Link
              href="/parent/settings?open=add-child"
              className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white text-sm text-center active:scale-[0.98] transition-transform cursor-pointer"
              style={{ background: "var(--color-k-navy)" }}
            >
              아이 추가하기
            </Link>
          </div>
          <RealParentNav active="홈" />
        </div>
        {renderInvitePopup()}
      </DemoFrame>
    );
  }



  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--color-k-background)" }}>
        <AppEventAnnouncementModal />
        <ParentHomeHeader />
        <NotificationOnboarding role="parent" />

        <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-8">
          {reportLoading ? (
            <>
              <div className="bg-[#10315B] rounded-[20px] p-5 shadow-sm mt-4 mb-6">
                <SkeletonBox className="w-24 h-4 mb-3" />
                <SkeletonBox className="w-full h-4 mb-1" />
                <SkeletonBox className="w-2/3 h-4" />
              </div>
              <div className={`grid ${view === "tablet" ? "grid-cols-4" : "grid-cols-2"} gap-3 mb-8`}>
                {Array.from({ length: 8 }).map((_, i) => (
                  <SkeletonBox key={i} className="h-32 rounded-[18px]" />
                ))}
              </div>
            </>
          ) : reportError ? (
            <div className="mt-8 flex flex-col items-center text-center px-4 mb-8">
              <p className="text-4xl mb-4">⚠️</p>
              {reportError.status === 403 ? (
                <p className="text-sm font-bold text-gray-800">이 자녀의 리포트를 확인할 권한이 없어요.</p>
              ) : reportError.status === 0 ? (
                <>
                  <p className="text-sm font-bold text-gray-800">네트워크 연결이 끊어졌어요.</p>
                  <p className="text-xs text-gray-500 mt-1 mb-4">인터넷 연결을 확인하고 다시 시도해 주세요.</p>
                  <button 
                    onClick={() => fetchReports()} 
                    className="px-6 py-2.5 bg-k-navy text-white text-sm font-bold rounded-xl active:scale-95 cursor-pointer"
                  >
                    재시도
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-gray-800">대화 가이드를 불러오지 못했어요.</p>
                  <p className="text-xs text-gray-500 mt-1 mb-4">잠시 후 다시 시도해 주세요.</p>
                  <button 
                    onClick={() => fetchReports()} 
                    className="px-6 py-2.5 bg-k-navy text-white text-sm font-bold rounded-xl active:scale-95 cursor-pointer"
                  >
                    재시도
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              <TodayConversationGuide guideText={todaysQuote ?? undefined} />
              <ParentMissionEventStatus childId={activeChild?.id ?? null} childName={activeChild?.name ?? ""} />
              <InsightGrid insights={insightsData} view={view} />
            </>
          )}
        </div>

        <RealParentNav active="홈" />
      </div>
      {renderInvitePopup()}
    
        <KChatbotWidget appSurface="parent" />
      </DemoFrame>
  );
}
