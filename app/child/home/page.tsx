"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import KChatbotWidget from "@/components/KChatbotWidget";
import AppEventAnnouncementModal from "@/components/events/AppEventAnnouncementModal";
import MissionOnboardingCard from "@/components/events/MissionOnboardingCard";
import AttendanceRouletteLoginModal from "@/components/events/AttendanceRouletteLoginModal";
import { PwaInstallGuideModal } from "@/components/pwa/PwaInstallGuideModal";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { appendVocative } from "@/lib/utils/koreanParticle";
import { NotificationOnboarding } from "@/components/notifications/NotificationOnboarding";
import { useNotificationInbox } from "@/lib/notifications/useNotificationInbox";
import { revokeCurrentPushInstallation } from "@/lib/notifications/usePushSubscription";
import {
  parseMissionEntrySnapshot,
  resolveMissionDestination,
  resolveMissionDisplay,
} from "@/lib/mission-v3/clientEntry";
import type { MissionEntrySnapshot } from "@/lib/mission-v3/entryContract";

// 이 프로젝트는 아이콘 라이브러리(lucide-react/heroicons)를 설치하지 않고 인라인
// SVG·이모지만 사용하는 관례라(package.json에 둘 다 없음), 로그아웃/닫기 아이콘 2개만
// 위해 새 의존성을 추가하지 않고 최소 인라인 SVG로 대체한다.
function LogOut({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function Bell({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function X({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

type ChildInfo = { id: string; name: string; given_name?: string; grade: string };

export default function ChildHomePage() {
  const [child, setChild] = useState<ChildInfo | null>(null);
  const [goldKeyBalance, setGoldKeyBalance] = useState<number | null>(null);
  const [noChild, setNoChild] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Mission snapshot state
  const [missionSnapshot, setMissionSnapshot] = useState<MissionEntrySnapshot | null>(null);
  
  // PWA install banner state
  const {
    context,
    isReady,
    canShowInstallEntry,
    activeGuide,
    guideContext,
    requestInstall,
    closeGuide,
  } = useInstallPrompt();
  const [showPwaBanner, setShowPwaBanner] = useState(false);
  const [isLogoutProcessing, setIsLogoutProcessing] = useState(false);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const { unreadCount: notificationUnreadCount } = useNotificationInbox({ loadItems: false });
  const [rouletteGateResolved, setRouletteGateResolved] = useState(false);
  const handleRouletteGateResolved = useCallback(() => setRouletteGateResolved(true), []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("event") === "announcement") {
      setIsEventModalOpen(true);
      window.history.replaceState({}, "", "/child/home");
    }
  }, []);

  useEffect(() => {
    // 1. /api/child/me를 호출하여 세션 기반의 아이 프로필 확인
    fetch("/api/child/me")
      .then(async (r) => {
        if (r.ok) {
          const data = await r.json();
          if (data && data.id) {
            setChild(data);
            localStorage.setItem("k_child_id", data.id);
            return true;
          }
        }
        return false;
      })
      .then((success) => {
        if (success) return;

        // 2. 세션에 없으면 기존 localStorage 및 ID 매핑 폴백
        const id = localStorage.getItem("k_child_id");
        if (!id) {
          setNoChild(true);
          setLoading(false);
          return;
        }
        fetch(`/api/child/${encodeURIComponent(id)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data) setChild(data);
            else {
              setNoChild(true);
              setLoading(false);
            }
          })
          .catch(() => {
            setNoChild(true);
            setLoading(false);
          });
      })
      .catch(() => {
        setNoChild(true);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!child?.id) return;

    const fetchAll = async () => {
      try {
        const [gkRes, progressRes] = await Promise.allSettled([
          fetch(`/api/goldkey/balance?childId=${child.id}`),
          fetch(`/api/mission/v3/today-progress?childId=${child.id}`)
        ]);

        if (gkRes.status === "fulfilled" && gkRes.value.ok) {
          const gkData = await gkRes.value.json();
          setGoldKeyBalance(gkData.balance);
        }

        // mission snapshot 조회 및 검증
        if (progressRes.status === "fulfilled" && progressRes.value.ok) {
          const raw = await progressRes.value.json();
          const snapshot = parseMissionEntrySnapshot(raw);
          setMissionSnapshot(snapshot);
        } else {
          setMissionSnapshot(null);
        }
      } catch (err) {
        console.error("Error fetching home data:", err);
        setMissionSnapshot(null);
      } finally {
        setLoading(false);
      }
    };
    
    fetchAll();
  }, [child?.id]);

  useEffect(() => {
    if (!isReady) return;

    const bannerHidden = sessionStorage.getItem("hide_pwa_banner");
    setShowPwaBanner(canShowInstallEntry && !bannerHidden);
  }, [canShowInstallEntry, isReady]);

  const handleDismissPwa = () => {
    sessionStorage.setItem("hide_pwa_banner", "true");
    setShowPwaBanner(false);
  };

  const onInstallClick = async () => {
    const outcome = await requestInstall();
    if (outcome === "accepted") {
      setShowPwaBanner(false);
    }
  };

  const handleLogout = async () => {
    if (isLogoutProcessing) return;
    if (window.confirm("로그아웃할까요?")) {
      setIsLogoutProcessing(true);
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      await revokeCurrentPushInstallation();
      await supabase.auth.signOut();
      localStorage.removeItem("k_child_id");
      localStorage.removeItem("login_role");
      window.location.href = "/login?role=child";
    }
  };

  if (loading) {
    return (
      <DemoFrame>
        <div className="h-full flex items-center justify-center" style={{ background: "linear-gradient(180deg, #BFE8FF 0%, #EAF7FF 38%, #FFF9F2 75%, #FFF7E9 100%)" }}>
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-k-navy) var(--color-k-navy) transparent transparent" }} />
        </div>
      </DemoFrame>
    );
  }

  if (noChild) {
    return (
      <DemoFrame>
        <div className="h-full flex flex-col items-center justify-center px-6 py-8 text-center bg-k-background">
          <div className="max-w-md w-full bg-k-surface rounded-3xl p-8 shadow-md border border-k-orange/10">
            <p className="text-5xl mb-4">🌱</p>
            <p className="text-lg font-bold" style={{ color: "var(--color-k-orange)" }}>가족 연결이 필요해요</p>
            <p className="text-xs mt-3 leading-relaxed" style={{ color: "var(--color-k-sky-blue)" }}>
              현재 로그인한 구글 계정이 가족에 등록되어 있지 않습니다.
              <br />
              부모님 앱에서 아이 추가 화면을 통해 이메일을 예약 등록했는지 확인해 주세요.
            </p>

            <button
              onClick={handleLogout}
              disabled={isLogoutProcessing}
              className="w-full py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform mt-6 cursor-pointer bg-k-orange"
            >
              로그아웃 후 다시 로그인하기
            </button>
          </div>
        </div>
      </DemoFrame>
    );
  }

  const childName = child?.given_name || child?.name || "";
  const greetingName = childName ? appendVocative(childName) : "안녕";
  const greetingTitle = childName ? `안녕, ${greetingName}!` : "안녕!";

  const isV3Policy = missionSnapshot?.policyVersion === "v3_single_daily";

  let missionTitle = "미션 진행";
  let missionDesc = "오늘의 미션을 시작해요";
  let missionBubble = "오늘의 미션을 시작해 볼까?";
  let progressText = "";

  let missionUrl = "/child/missions";
  let isClickBlocked = false;

  if (missionSnapshot) {
    const display = resolveMissionDisplay(missionSnapshot);
    const destination = resolveMissionDestination(missionSnapshot);

    missionTitle = display.title;
    missionDesc = display.description;
    missionBubble = missionSnapshot.entryState === "resume"
      ? "미션이 진행되고 있어요. 같이 할까?"
      : display.bubble || "오늘의 미션을 시작해 볼까?";
    progressText = display.badge || "";

    if (isV3Policy) {
      // v3 전용 화면은 폐기됐다. 기존 미션 화면이 정책에 따라 v3 계약을 처리한다.
      if (destination.kind === "blocked") {
        const reason = destination.reason;
        if (reason === "before_open" || reason === "closed" || reason === "unavailable") {
          missionUrl = "#";
          isClickBlocked = true;
        } else {
          // completed, safety_paused, force_ended -> 종료 화면 확인을 위해 진입 허용
          missionUrl = "/child/missions";
          isClickBlocked = false;
        }
      } else {
        missionUrl = "/child/missions";
        isClickBlocked = false;
      }
    }
  }

  const handleMissionClick = (e: React.MouseEvent) => {
    if (isClickBlocked) {
      e.preventDefault();
    }
  };

  return (
    <DemoFrame>
      <div className="relative h-full flex flex-col overflow-y-auto overflow-x-hidden w-full text-[var(--color-k-navy)]"
           style={{ background: "linear-gradient(180deg, #BFE8FF 0%, #EAF7FF 38%, #FFF9F2 75%, #FFF7E9 100%)" }}>
        {child?.id && (
          <AttendanceRouletteLoginModal
            childId={child.id}
            onBalanceChange={setGoldKeyBalance}
            onGateResolved={handleRouletteGateResolved}
          />
        )}
        <NotificationOnboarding role="child" />
        {rouletteGateResolved && !isEventModalOpen && <AppEventAnnouncementModal />}
        {isEventModalOpen && <AppEventAnnouncementModal manualOpen onClose={() => setIsEventModalOpen(false)} />}

        {/* Background Clouds (decorative) */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-50 flex items-start justify-between pt-24 px-4 z-0">
           <div className="w-16 h-8 bg-white rounded-full blur-[2px] opacity-80" style={{ transform: "scale(1.5)" }} />
           <div className="w-20 h-10 bg-white rounded-full blur-[2px] opacity-80 mt-12" style={{ transform: "scale(1.2)" }} />
        </div>
        
        {/* Top Action Bar */}
        <div className="shrink-0 flex items-center justify-between px-4 pt-[env(safe-area-inset-top)] mt-4 relative z-10 w-full max-w-[430px] mx-auto child-home-content">
          <Link
            href="/child/notifications"
            className="relative flex h-[44px] w-[44px] items-center justify-center rounded-2xl bg-white/50 shadow-sm transition-transform active:scale-95"
            aria-label={notificationUnreadCount > 0 ? `알림 ${notificationUnreadCount}개` : "알림"}
          >
            <Bell size={18} color="var(--color-k-navy)" />
            {notificationUnreadCount > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-[#E25B12] px-1 text-[10px] font-bold text-white">{notificationUnreadCount > 99 ? "99+" : notificationUnreadCount}</span>}
          </Link>
          {/* Mission Event Pill (Hidden as requested: "이 영역은 숨김 처리") */}
          <div className="invisible">
            <div className="px-4 py-1.5 bg-white/70 rounded-full border border-[var(--color-k-navy)] shadow-sm text-sm font-semibold">
              🔥 이번 달 미션 진행
            </div>
          </div>
          <button 
            onClick={handleLogout}
            disabled={isLogoutProcessing}
            className="w-[44px] h-[44px] flex items-center justify-center rounded-2xl bg-white/50 shadow-sm transition-transform active:scale-95"
            aria-label="로그아웃"
          >
            <LogOut size={20} color="var(--color-k-navy)" />
          </button>
        </div>

        <div className="flex-1 w-full max-w-[430px] mx-auto px-4 pb-20 flex flex-col relative z-10 child-home-content">
          
          {/* Mascot Area */}
          <div
            data-testid="child-home-mascot"
            className="relative flex h-[202px] shrink-0 items-end justify-center"
          >
            {/* Bright pedestal keeps the mascot grounded, as in the target composition. */}
            <div className="absolute bottom-1 left-1/2 h-[30px] w-[205px] -translate-x-1/2 rounded-[50%] border border-white/80 bg-gradient-to-b from-white to-[#DCE8F1] shadow-[0_9px_20px_rgba(48,91,124,0.18)]" />
            <Image
              src="/Images/mascot/mascot-standing.png"
              alt="케이 마스코트"
              width={205}
              height={205}
              className="relative z-10 mb-2 h-auto object-contain drop-shadow-[0_7px_5px_rgba(32,71,102,0.18)]"
              style={{ width: "clamp(160px, 44vw, 178px)" }}
              priority
            />
          </div>

          {/* Greeting Area */}
          <div
            data-testid="child-home-greeting"
            className="mt-3 flex flex-col items-center px-3 text-center"
          >
            <h1 className="font-brand text-[25px] font-extrabold leading-[1.45] tracking-[0.02em]">
              {greetingTitle}<br/>오늘은 뭐 하고 놀까?
            </h1>
          </div>

          {/* Status Bubble */}
          <div data-testid="mission-status-bubble" className="mb-5 mt-3 flex justify-center">
            <div className="relative inline-block max-w-[88%] rounded-full border border-black/5 bg-white px-5 py-2.5 text-center text-[15px] font-medium shadow-[0_4px_10px_rgba(42,66,86,0.15)]">
              {missionBubble}
              {/* Triangle pointer */}
              <div className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-black/5 bg-white" />
            </div>
          </div>

          <MissionOnboardingCard />

          {/* Primary Action Cards */}
          <div className="mt-2 flex flex-col gap-2.5">
            {/* Mission Card (Primary) */}
            <Link 
              href={missionUrl}
              onClick={handleMissionClick}
              data-testid="mission-primary-card"
              className="flex min-h-[74px] w-full items-center gap-3 rounded-[22px] px-4 py-3 shadow-[0_6px_14px_rgba(197,77,9,0.20)] transition-transform active:scale-[0.98]"
              style={{ background: "var(--color-k-orange)" }}
            >
              <div className="flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-[17px] bg-white/25 text-[28px] shadow-inner">
                🎯
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-white font-bold text-[17px] leading-snug">{missionTitle}</p>
                <p className="text-white/90 text-[14px] mt-0.5 truncate">{missionDesc}</p>
              </div>
              {progressText && (
                <div className="shrink-0 text-[var(--color-k-navy)] font-bold text-[13px] bg-white px-2.5 py-1 rounded-full shadow-sm">
                  {progressText}
                </div>
              )}
            </Link>

            {/* Sub Cards (Grid) */}
            <div data-testid="child-home-action-grid" className="grid grid-cols-2 gap-2.5">
              {/* Talk Card */}
              <Link 
                href="/chat"
                className="flex min-h-[88px] w-full items-center gap-2.5 rounded-[20px] px-3 py-3.5 shadow-[0_5px_12px_rgba(136,82,25,0.14)] transition-transform active:scale-[0.98]"
                style={{ background: "var(--color-k-mascot-orange)" }}
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-white/30 text-[22px] shadow-inner">
                  💬
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-[var(--color-k-navy)] font-bold text-[16px] leading-tight">대화하기</p>
                  <p className="text-[var(--color-k-navy)]/80 text-[13px] mt-1 leading-snug line-clamp-2">케이랑 이야기 나눠요</p>
                </div>
              </Link>

              {/* Play Card */}
              <Link 
                href="/child/play"
                className="flex min-h-[88px] w-full items-center gap-2.5 rounded-[20px] px-3 py-3.5 shadow-[0_5px_12px_rgba(35,102,145,0.16)] transition-transform active:scale-[0.98]"
                style={{ background: "var(--color-k-sky-blue)" }}
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-white/25 text-[22px] shadow-inner">
                  🎮
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-[var(--color-k-navy)] font-bold text-[16px] leading-tight">게임 참여</p>
                  <p className="text-[var(--color-k-navy)]/80 text-[13px] mt-1 leading-snug line-clamp-2">
                    {goldKeyBalance !== null ? `🔑 ${goldKeyBalance}개 보유` : "재미있는 놀이를 해봐요"}
                  </p>
                </div>
              </Link>
            </div>

            <div
              data-testid="gold-key-expiry-notice"
              className="mt-1 flex min-h-[62px] items-center justify-center gap-3 rounded-[18px] border border-white/80 bg-[#FFF0DE]/90 px-4 py-3 text-center shadow-[0_5px_14px_rgba(139,83,34,0.12)]"
            >
              <span aria-hidden="true" className="text-[34px] leading-none drop-shadow-sm">🔑</span>
              <p className="text-[14px] font-bold leading-relaxed text-[#A8521F]">
                황금열쇠는 받은 날부터 7일 안에<br className="hidden min-[360px]:block" /> 사용하지 않으면 사라져요
              </p>
            </div>
          </div>
        </div>
        
        {/* PWA Install Banner */}
        {showPwaBanner && (
          <div className="sticky bottom-0 w-full bg-[#FFF9F2] border-t border-black/5 shadow-[0_-4px_12px_rgba(0,0,0,0.05)] p-4 flex items-center justify-between z-50 mt-auto pb-[env(safe-area-inset-bottom,16px)]">
            <p className="text-sm font-semibold text-[var(--color-k-navy)] px-2">모바일 / 태블릿 / PC</p>
            <div className="flex items-center gap-3">
              <button
                onClick={onInstallClick}
                className="h-[44px] min-w-[112px] px-5 rounded-full bg-[var(--color-k-orange)] text-white font-bold text-[15px] whitespace-nowrap shadow-sm active:scale-95 transition-transform"
              >
                앱 설치하기
              </button>
              <button 
                onClick={handleDismissPwa}
                className="w-[44px] h-[44px] flex items-center justify-center rounded-full bg-black/5 text-[var(--color-k-navy)] active:bg-black/10 transition-colors"
                aria-label="닫기"
              >
                <X size={20} />
              </button>
            </div>
          </div>
        )}

      </div>

      <KChatbotWidget appSurface="child" containerMaxWidthPx={430} />
      <PwaInstallGuideModal
        isOpen={activeGuide !== null}
        context={guideContext ?? context}
        onClose={closeGuide}
      />
    </DemoFrame>
  );
}
