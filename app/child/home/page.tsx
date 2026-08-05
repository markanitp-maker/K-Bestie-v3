"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import KChatbotWidget from "@/components/KChatbotWidget";
import AppEventAnnouncementModal from "@/components/events/AppEventAnnouncementModal";
import MissionOnboardingCard from "@/components/events/MissionOnboardingCard";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { appendVocative } from "@/lib/utils/koreanParticle";

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
  
  // Mission state
  const [missionStatus, setMissionStatus] = useState<any>(null);
  const [missionClosed, setMissionClosed] = useState(false);
  
  // PWA install banner state
  const { installPrompt, isIOS, isStandalone, handleInstall } = useInstallPrompt();
  const [showPwaBanner, setShowPwaBanner] = useState(false);
  const [isLogoutProcessing, setIsLogoutProcessing] = useState(false);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);

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
        const [gkRes, timeCfgRes, progressRes] = await Promise.allSettled([
          fetch(`/api/goldkey/balance?childId=${child.id}`),
          fetch("/api/config/child-time-restrictions"),
          fetch(`/api/mission/today-progress?childId=${child.id}`)
        ]);

        if (gkRes.status === "fulfilled" && gkRes.value.ok) {
          const gkData = await gkRes.value.json();
          setGoldKeyBalance(gkData.balance);
        }

        let timeRestrictionsEnabled = false;
        if (timeCfgRes.status === "fulfilled" && timeCfgRes.value.ok) {
          const cfg = await timeCfgRes.value.json();
          if (typeof cfg.enabled === "boolean") timeRestrictionsEnabled = cfg.enabled;
        }

        // 운영시간 게이트는 이 화면에서 다시 계산하지 않고 /api/mission/today-progress가
        // 돌려주는 currentRound(lib/mission/missionTimeGate.ts와 동일 정본 로직)를 그대로
        // 신뢰한다 — 예전에 이 화면이 자체적으로 13~19시/19~23시로 다시 계산했다가 실제
        // 미션 화면의 13~17시/19~23시 정책과 어긋난 적이 있어(리뷰에서 발견) 소스를 하나로 통일.
        if (progressRes.status === "fulfilled" && progressRes.value.ok) {
          const progData = await progressRes.value.json();
          setMissionStatus(progData);
          if (!progData.activeRound && timeRestrictionsEnabled) {
            setMissionClosed(true);
          }
        }
      } catch (err) {
        console.error("Error fetching home data:", err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchAll();
  }, [child?.id]);

  useEffect(() => {
    // installPrompt/isIOS로만 게이트하면 미지원 브라우저(예: 데스크톱 Firefox)에서 배너 자체가
    // 나오지 않아 onInstallClick의 "미지원 안내" 분기가 영원히 도달 불가능해진다 — standalone이
    // 아니고 닫지 않았으면 항상 노출하고, 지원 여부 판단은 클릭 시점에 한다.
    const bannerHidden = sessionStorage.getItem("hide_pwa_banner");
    setShowPwaBanner(!isStandalone && !bannerHidden);
  }, [isStandalone]);

  const handleDismissPwa = () => {
    sessionStorage.setItem("hide_pwa_banner", "true");
    setShowPwaBanner(false);
  };

  const onInstallClick = async () => {
    if (installPrompt) {
      await handleInstall();
      setShowPwaBanner(false);
    } else if (isIOS) {
      alert("공유 버튼을 누른 뒤 ‘홈 화면에 추가’를 선택해 주세요.");
    } else {
      alert("현재 브라우저는 앱 설치를 지원하지 않습니다. Chrome 또는 Edge를 사용해 주세요.");
    }
  };

  const handleLogout = async () => {
    if (isLogoutProcessing) return;
    if (window.confirm("로그아웃할까요?")) {
      setIsLogoutProcessing(true);
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
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

  let missionTitle = "미션 진행";
  let missionDesc = "오늘의 미션을 시작해요";
  let missionBubble = "오늘의 미션을 시작해 볼까?";
  let missionUrl = "/child/missions";
  let progressText = "";
  
  if (missionClosed) {
    missionBubble = "지금은 미션을 할 수 없는 시간이야.";
  } else if (missionStatus?.hasMission) {
    if (missionStatus.status === "COMPLETED" || missionStatus.validAnswerCount >= missionStatus.requiredCount) {
      missionTitle = "미션 완료";
      missionDesc = "오늘의 미션을 모두 완료했어요";
      missionBubble = "오늘의 미션을 모두 완료했어!";
      progressText = "완료";
    } else if (missionStatus.status === "IN_PROGRESS" || missionStatus.validAnswerCount > 0) {
      missionTitle = "미션 계속하기";
      missionDesc = "진행 중인 미션을 이어서 해요";
      missionBubble = "미션이 진행되고 있어요. 같이 할까?";
      progressText = `${missionStatus.validAnswerCount}/${missionStatus.requiredCount}`;
    }
  }

  return (
    <DemoFrame>
      <div className="relative h-full flex flex-col overflow-y-auto overflow-x-hidden w-full text-[var(--color-k-navy)]"
           style={{ background: "linear-gradient(180deg, #BFE8FF 0%, #EAF7FF 38%, #FFF9F2 75%, #FFF7E9 100%)" }}>
        <AppEventAnnouncementModal />
        {isEventModalOpen && <AppEventAnnouncementModal manualOpen onClose={() => setIsEventModalOpen(false)} />}

        {/* Background Clouds (decorative) */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-50 flex items-start justify-between pt-24 px-4 z-0">
           <div className="w-16 h-8 bg-white rounded-full blur-[2px] opacity-80" style={{ transform: "scale(1.5)" }} />
           <div className="w-20 h-10 bg-white rounded-full blur-[2px] opacity-80 mt-12" style={{ transform: "scale(1.2)" }} />
        </div>
        
        {/* Top Action Bar */}
        <div className="shrink-0 flex items-center justify-between px-4 pt-[env(safe-area-inset-top)] mt-4 relative z-10 w-full max-w-[430px] mx-auto child-home-content">
          <button
            onClick={() => setIsEventModalOpen(true)}
            className="flex items-center gap-1.5 h-[44px] px-3 rounded-2xl bg-white/50 shadow-sm transition-transform active:scale-95"
            aria-label="이벤트 안내 보기"
          >
            <Bell size={18} color="var(--color-k-navy)" />
            <span className="text-sm font-bold text-[var(--color-k-navy)]">이벤트</span>
          </button>
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
          <div className="flex flex-col items-center justify-center relative" style={{ height: '160px' }}>
            <Image
              src="/Images/mascot/mascot-standing.png"
              alt="케이 마스코트"
              width={205}
              height={205}
              className="object-contain drop-shadow-md z-10"
              style={{ width: "clamp(120px, 42%, 164px)", height: "auto" }}
              priority
            />
            {/* Oval shadow under mascot */}
            <div className="absolute bottom-0 w-32 h-4 bg-black/5 rounded-[50%] blur-[2px]"></div>
          </div>

          {/* Greeting Area */}
          <div className="flex flex-col items-center text-center mt-2 mb-2">
            <h1 className="font-brand text-[24px] font-extrabold leading-[1.35]">
              {greetingTitle}<br/>오늘은 뭐 하고 놀까?
            </h1>
          </div>

          <MissionOnboardingCard />

          {/* Status Bubble */}
          <div className="flex justify-center mb-3">
            <div className="relative bg-white px-4 py-2.5 rounded-full border border-[var(--color-k-orange)] shadow-sm text-[15px] font-medium inline-block max-w-[80%] text-center">
              {missionBubble}
              {/* Triangle pointer */}
              <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-b border-r border-[var(--color-k-orange)] transform rotate-45"></div>
            </div>
          </div>

          {/* Primary Action Cards */}
          <div className="flex flex-col gap-3">
            {/* Mission Card (Primary) */}
            <Link 
              href={missionUrl}
              className="flex items-center gap-3 rounded-[22px] px-4 py-3 shadow-sm transition-transform active:scale-[0.98] w-full"
              style={{ background: "var(--color-k-orange)" }}
            >
              <div className="w-[52px] h-[52px] rounded-[18px] flex items-center justify-center text-[28px] shrink-0 bg-white/25">
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
            <div className="grid grid-cols-2 gap-2.5">
              {/* Talk Card */}
              <Link 
                href="/chat"
                className="flex flex-col items-start gap-2.5 rounded-[20px] px-3.5 py-3.5 shadow-sm transition-transform active:scale-[0.98] w-full"
                style={{ background: "var(--color-k-mascot-orange)" }}
              >
                <div className="w-11 h-11 rounded-[14px] flex items-center justify-center text-[22px] shrink-0 bg-white/30">
                  💬
                </div>
                <div className="flex-1 text-left min-w-0 w-full mt-1">
                  <p className="text-[var(--color-k-navy)] font-bold text-[16px] leading-tight">대화하기</p>
                  <p className="text-[var(--color-k-navy)]/80 text-[13px] mt-1 leading-snug line-clamp-2">케이랑 이야기 나눠요</p>
                </div>
              </Link>

              {/* Play Card */}
              <Link 
                href="/child/play"
                className="flex flex-col items-start gap-2.5 rounded-[20px] px-3.5 py-3.5 shadow-sm transition-transform active:scale-[0.98] w-full"
                style={{ background: "var(--color-k-sky-blue)" }}
              >
                <div className="w-11 h-11 rounded-[14px] flex items-center justify-center text-[22px] shrink-0 bg-white/25">
                  🎮
                </div>
                <div className="flex-1 text-left min-w-0 w-full mt-1">
                  <p className="text-[var(--color-k-navy)] font-bold text-[16px] leading-tight">케이와 놀이</p>
                  <p className="text-[var(--color-k-navy)]/80 text-[13px] mt-1 leading-snug line-clamp-2">
                    {goldKeyBalance !== null ? `🔑 ${goldKeyBalance}개 보유` : "재미있는 놀이를 해봐요"}
                  </p>
                </div>
              </Link>
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
                className="h-[44px] px-5 rounded-full bg-[var(--color-k-orange)] text-white font-bold text-[15px] shadow-sm active:scale-95 transition-transform"
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
    </DemoFrame>
  );
}
