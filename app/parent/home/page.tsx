"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useStore } from "@/hooks/useStore";
import { createClient } from "@/lib/supabase/client";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealParentNav } from "@/components/RealParentNav";
import { ParentHeader } from "@/components/ParentHeader";
import { useDemoView } from "@/app/demo/components/DemoViewContext";
import { SkeletonBox } from "@/components/Skeleton";

type EmotionLevel = "safe" | "warning" | "danger";

interface DashboardCards {
  school_life?: string;
  peer_relations?: string;
  interests?: string;
  study_concerns?: string;
  digital_interests?: string;
  future_dreams?: string;
  recurring_stories?: string;
}

interface Report {
  id: string;
  summary_line: string;
  mood_score: number;
  emotion_tags: string[];
  parent_guide: string;
  emotion_level: EmotionLevel | null;
  dashboard_cards: DashboardCards | null;
  created_at: string;
}

const EMOTION_HINT_MAP: Record<EmotionLevel, { emoji: string; label: string }> = {
  safe: { emoji: "🌿", label: "안정적이에요" },
  warning: { emoji: "🍂", label: "마음 살펴주세요" },
  danger: { emoji: "❤️‍🩹", label: "지금 함께해주세요" },
};

export default function ParentHomePage() {
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

  // 가족 초대 팝업 관련 상태
  const [pendingInvite, setPendingInvite] = useState<{ id: string; familyName: string; inviterName: string } | null>(null);
  const [currentFamily, setCurrentFamily] = useState<{ id: string; name: string; hasChildren: boolean; otherGuardianCount: number } | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [agreeTransition, setAgreeTransition] = useState(false);
  const [invitePopupLoading, setInvitePopupLoading] = useState(true);
  const [inviteActionLoading, setInviteActionLoading] = useState(false);
  const [inviteActionError, setInviteActionError] = useState<string | null>(null);

  useEffect(() => {
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

  const renderInvitePopup = () => {
    if (!pendingInvite) return null;

    // 충돌 상태 계산 (다른 보호자가 있는 기존 가족 소속인 경우)
    const isConflict = currentFamily !== null && currentFamily.otherGuardianCount > 0;

    return (
      <>
        {/* 1단계: 초대 팝업 */}
        {!showConfirmModal && (
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
                    style={{ background: "#1a6b5a" }}
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
                        className="mt-1 cursor-pointer w-4 h-4 accent-[#1a6b5a]"
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
                  style={{ background: "#1a6b5a" }}
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
  const [ownerEmail, setOwnerEmail] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinRequestStatus, setJoinRequestStatus] = useState<"loading" | "none" | "pending">("loading");
  const [incomingRequests, setIncomingRequests] = useState<any[]>([]);

  const activeChild = children.find((c) => c.id === store.activeChildId) ?? children[0] ?? null;

  const checkJoinRequest = async () => {
    if (store.activeFamilyId) {
      setJoinRequestStatus("none");
      return;
    }
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setJoinRequestStatus("none");
        return;
      }
      
      const { data } = await supabase
        .from("family_join_requests")
        .select("id, status")
        .eq("requester_user_id", user.id)
        .eq("status", "pending")
        .maybeSingle();

      if (data) {
        setJoinRequestStatus("pending");
      } else {
        setJoinRequestStatus("none");
      }
    } catch {
      setJoinRequestStatus("none");
    }
  };

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
    fetch("/api/parents/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.parent?.name) {
          setParentName(data.parent.name);
        }
      })
      .catch(() => {});

    // 로그인(OAuth 콜백/구성원 로그인) 직후 어디서도 로컬 캐시를 DB와 동기화하지 않아서,
    // 이미 가족이 있는 부모도 activeFamilyId가 비어있는 채로 온보딩(가족 만들기/참여하기)
    // 화면을 매번 다시 보게 되던 버그 수정 — 마운트 시 항상 먼저 동기화한다.
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
      checkJoinRequest();
      loadIncomingRequests();
    } else if (store.activeFamilyId) {
      setJoinRequestStatus("none");
    }
  }, [mounted, store.activeFamilyId]);

  useEffect(() => {
    if (joinRequestStatus !== "pending" || store.activeFamilyId) return;
    const interval = setInterval(async () => {
      const { syncChildrenFromDB } = await import("@/lib/store");
      await syncChildrenFromDB();
    }, 5000);
    return () => clearInterval(interval);
  }, [joinRequestStatus, store.activeFamilyId]);

  const handleJoinRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ownerEmail.trim()) return;
    setJoinError(null);
    setJoining(true);

    try {
      const res = await fetch("/api/family-join-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_email: ownerEmail.trim() }),
      });

      const data = await res.json();
      if (res.ok) {
        setJoinRequestStatus("pending");
      } else {
        if (res.status === 404) {
          setJoinError("해당 이메일로 만든 가족을 찾을 수 없어요");
        } else if (res.status === 403) {
          setJoinError("이미 보호자가 2명이라 신청할 수 없어요");
        } else if (res.status === 409) {
          setJoinError("이미 신청했거나 구성원이에요");
        } else {
          setJoinError(data.error || "신청에 실패했습니다.");
        }
      }
    } catch {
      setJoinError("네트워크 에러가 발생했습니다.");
    } finally {
      setJoining(false);
    }
  };

  useEffect(() => {
    if (!activeChild) {
      setLatestReport(null);
      return;
    }
    setReportLoading(true);
    fetch(`/api/parent/reports?childId=${encodeURIComponent(activeChild.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const reports: Report[] = data?.reports ?? [];
        if (reports.length > 0) {
          setLatestReport(reports[0]);
        } else {
          setLatestReport(null);
        }
      })
      .catch(() => {
        setLatestReport(null);
      })
      .finally(() => setReportLoading(false));
  }, [activeChild?.id]);

  if (!mounted || syncingFamily) {
    return (
      <DemoFrame>
        <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
          <ParentHeader />
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-8">
            <SkeletonBox className="h-[72px] mb-6" />
            <SkeletonBox className="w-28 h-5 mb-3" />
            <div className={`grid ${view === "tablet" ? "grid-cols-4" : "grid-cols-2"} gap-3`}>
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonBox key={i} className="h-24" />
              ))}
            </div>
          </div>
          <div className="h-16 shrink-0 border-t" style={{ borderColor: "#f3f4f6" }} />
        </div>
      </DemoFrame>
    );
  }

  // 가족 만들기 / 참여하기 분기 렌더링
  if (!store.activeFamilyId) {
    if (joinRequestStatus === "loading") {
      return (
        <DemoFrame>
          <div className="h-full flex items-center justify-center" style={{ background: "#fafaf8" }}>
            <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#1a6b5a #1a6b5a transparent transparent" }} />
          </div>
          {renderInvitePopup()}
        </DemoFrame>
      );
    }

    if (joinRequestStatus === "pending") {
      return (
        <DemoFrame>
          <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
            <ParentHeader />
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-14 flex flex-col items-center text-center gap-6">
              <p className="text-5xl">⏳</p>
              <div>
                <p className="text-base font-bold text-gray-800">가입 신청 대기 중</p>
                <p className="text-xs mt-1.5 leading-relaxed text-gray-500">
                  신청이 접수됐어요. 오너의 승인을 기다려주세요.
                </p>
              </div>
              <button
                onClick={async () => {
                  const { syncChildrenFromDB } = await import("@/lib/store");
                  await syncChildrenFromDB();
                  await checkJoinRequest();
                }}
                className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform cursor-pointer"
                style={{ background: "#1a6b5a" }}
              >
                새로고침
              </button>
            </div>
          </div>
          {renderInvitePopup()}
        </DemoFrame>
      );
    }

    return (
      <DemoFrame>
        <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
          <ParentHeader />

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
                            className="px-2 py-1 bg-[#1a6b5a] text-white rounded-lg text-[11px] font-bold cursor-pointer active:scale-95"
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

              <div className="w-full max-w-xs flex flex-col gap-4 mt-2">
                <button
                  onClick={() => setViewState("create_family")}
                  className="w-full py-4 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform text-center cursor-pointer"
                  style={{ background: "#1a6b5a" }}
                >
                  가족 만들기
                </button>
                <button
                  onClick={() => {
                    setViewState("join_family");
                    setJoinError(null);
                    setOwnerEmail("");
                  }}
                  className="w-full py-4 rounded-2xl font-bold text-sm bg-white border border-gray-200 text-gray-700 active:scale-[0.98] transition-transform text-center cursor-pointer"
                >
                  가족 구성원으로 참여하기
                </button>
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
                  style={{ background: "#1a6b5a" }}
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
                  이미 가족을 만든 오너의 이메일 주소를 입력해 참여 신청을 보내세요.
                </p>
              </div>
              <form onSubmit={handleJoinRequestSubmit} className="w-full max-w-xs flex flex-col gap-3">
                <input
                  type="email"
                  placeholder="오너의 이메일 주소"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  className="w-full rounded-2xl px-4 py-3.5 text-sm border border-gray-200 outline-none bg-white text-center"
                  required
                />
                {joinError && (
                  <p className="text-xs font-semibold text-red-500 mt-1">{joinError}</p>
                )}
                <button
                  type="submit"
                  disabled={joining || !ownerEmail.trim()}
                  className="w-full py-3.5 rounded-2xl font-bold text-white text-sm disabled:opacity-50 active:scale-[0.98] transition-transform cursor-pointer"
                  style={{ background: "#1a6b5a" }}
                >
                  {joining ? "신청하는 중..." : "신청하기 →"}
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
        </div>
        {renderInvitePopup()}
      </DemoFrame>
    );
  }

  // 아이가 아예 등록되어 있지 않은 경우
  if (children.length === 0) {
    return (
      <DemoFrame>
        <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
          <ParentHeader />
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-14 flex flex-col items-center text-center gap-6">
            <p className="text-5xl">🧒</p>
            <div>
              <p className="text-base font-bold text-gray-800">아직 등록된 아이가 없어요</p>
              <p className="text-xs mt-1.5 leading-relaxed text-gray-500">
                설정 메뉴나 온보딩을 통해 자녀를 먼저 등록해 보세요.
              </p>
            </div>
            <Link
              href="/onboarding"
              className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white text-sm text-center active:scale-[0.98] transition-transform cursor-pointer"
              style={{ background: "#1a6b5a" }}
            >
              아이 등록 온보딩 가기
            </Link>
          </div>
          <RealParentNav active="홈" />
        </div>
        {renderInvitePopup()}
      </DemoFrame>
    );
  }

  // 대시보드 카드 구성
  const dbCards = latestReport?.dashboard_cards ?? {};
  const currentEmotionLevel = latestReport?.emotion_level ?? null;

  const cardList = [
    { icon: "🏫", title: "학교·학원 생활", value: dbCards.school_life || "기록 없음" },
    { icon: "👥", title: "친구 관계와 또래 생활", value: dbCards.peer_relations || "기록 없음" },
    {
      icon: currentEmotionLevel ? EMOTION_HINT_MAP[currentEmotionLevel].emoji : "🙂",
      title: "감정 힌트",
      value: currentEmotionLevel ? EMOTION_HINT_MAP[currentEmotionLevel].label : "기록 없음",
    },
    { icon: "✨", title: "관심사와 개인 취향", value: dbCards.interests || "기록 없음" },
    { icon: "📚", title: "공부 고민", value: dbCards.study_concerns || "기록 없음" },
    { icon: "📱", title: "디지털 관심사와 콘텐츠 취향", value: dbCards.digital_interests || "기록 없음" },
    { icon: "🌈", title: "미래·진로·꿈", value: dbCards.future_dreams || "기록 없음" },
    { icon: "🔁", title: "반복되는 이야기", value: dbCards.recurring_stories || "기록 없음" },
  ];

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
        <ParentHeader />

        <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-8">
          <h2 className="text-base font-bold mb-3" style={{ color: "#1e1e2d" }}>
            아이 현황 보기
          </h2>

          {reportLoading ? (
            <div className={`grid ${view === "tablet" ? "grid-cols-4" : "grid-cols-2"} gap-3 mb-8`}>
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonBox key={i} className="h-24" />
              ))}
            </div>
          ) : (
            <div className={`grid ${view === "tablet" ? "grid-cols-4" : "grid-cols-2"} gap-3 mb-8`}>
              {cardList.map((card, i) => (
                <div key={i} className="bg-white rounded-2xl px-4 py-4 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="text-xl mb-2 select-none">{card.icon}</div>
                    <p className="text-[11px] mb-1 leading-tight" style={{ color: "#6b7280" }}>
                      {card.title}
                    </p>
                  </div>
                  <p
                    className="text-xs font-bold leading-normal mt-1 break-words"
                    style={{ color: card.value === "기록 없음" ? "#cbd5e1" : "#1e1e2d" }}
                  >
                    {card.value}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <RealParentNav active="홈" />
      </div>
      {renderInvitePopup()}
    </DemoFrame>
  );
}
