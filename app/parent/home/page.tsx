"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useStore } from "@/hooks/useStore";
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
import { ChildStartGuideModal } from "@/components/parent/ChildStartGuide";

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
  const [showChildStartGuide, setShowChildStartGuide] = useState(false);

  const activeChild = children.find((c) => c.id === store.activeChildId) ?? children[0] ?? null;

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

  // 가족 미소속 보호자는 일반 가입의 가족 만들기 단계로만 복귀한다.
  // 가족 참여는 /family/invite/[token] 전용 플로우에서만 처리한다.
  if (!store.activeFamilyId) {
    return (
      <DemoFrame>
        <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--color-k-background)" }}>
          <ParentHomeHeader />
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-14 flex flex-col items-center justify-center text-center gap-6">
            <p className="text-5xl" aria-hidden="true">🏡</p>
            <div>
              <p className="text-base font-bold text-gray-800">가족 만들기를 계속해 주세요</p>
              <p className="text-xs mt-1.5 leading-relaxed text-gray-500">회원가입 3단계에서 가족을 만든 뒤 아이를 등록할 수 있어요.</p>
            </div>
            <Link
              href="/signup?step=family"
              className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white text-sm text-center active:scale-[0.98] transition-transform"
              style={{ background: "var(--color-k-navy)" }}
            >
              가족 만들기 계속하기
            </Link>
          </div>
        </div>
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
              <section className="mb-4 rounded-[20px] border border-[#10315B]/10 bg-white p-4 shadow-sm" aria-label="아이 로그인 안내">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#FFF3E9] text-xl" aria-hidden="true">🧒</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-extrabold text-[#10315B]">아이와 케이 시작하기</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">아이 기기에서 로그인하거나 이 기기에서 바로 시작할 수 있어요.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowChildStartGuide(true)}
                    className="min-h-10 shrink-0 rounded-xl bg-[#10315B] px-3 text-[11px] font-bold text-white"
                  >
                    아이 시작하기
                  </button>
                </div>
              </section>
              <TodayConversationGuide guideText={todaysQuote ?? undefined} />
              <ParentMissionEventStatus childId={activeChild?.id ?? null} childName={activeChild?.name ?? ""} />
              <InsightGrid insights={insightsData} view={view} />
            </>
          )}
        </div>

        <RealParentNav active="홈" />
      </div>
      <ChildStartGuideModal
        open={showChildStartGuide}
        onClose={() => setShowChildStartGuide(false)}
        children={children}
      />
    
        <KChatbotWidget appSurface="parent" />
      </DemoFrame>
  );
}
