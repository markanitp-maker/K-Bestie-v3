"use client";

import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReportDetailSkeleton } from "@/app/parent/report/[id]/ReportDetailSkeleton";

type EmotionLevel = "safe" | "warning" | "danger";

export interface DailyReport {
  id: string;
  summary_line: string;
  mood_score: number;
  emotion_tags: string[];
  parent_guide: string;
  parent_conversation_clue?: string | null;
  recommended_questions?: string[] | null;
  emotion_level: EmotionLevel | null;
  created_at: string;
  school_academy_life?: string | null;
  peer_friendship?: string | null;
  emotion_hint?: string | null;
  interests_preferences?: string | null;
  study_concerns?: string | null;
  digital_content_interests?: string | null;
  future_dreams?: string | null;
  recurring_stories?: string | null;
  teacher_adults?: string | null;
  business_date: string;
}

export function formatBusinessDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return "";
  return `${month}월 ${day}일`;
}

export interface WeeklySummary {
  id: string;
  week_start: string;
  week_end: string;
  summary_text: string;
  detail_text: string;
  detail_dashboard_cards: Record<string, string> | null;
  mood_average: number;
  highlights: string[];
  parent_guide: string;
  parent_conversation_clue?: string | null;
  recommended_questions?: string[] | null;
  weekend_activity_recommendation: string;
}

const TABS = [
  { id: 1, label: "빠른 요약" },
  { id: 2, label: "상세 보기" },
  { id: 3, label: "추천 가이드" },
];

export function moodLabel(score: number): string {
  if (score <= 2) return "많이 힘들어 보여요";
  if (score <= 4) return "조금 힘들었던 것 같아요";
  if (score <= 6) return "평온한 하루였어요";
  if (score <= 8) return "즐거운 대화였어요";
  return "아주 신나는 하루였어요!";
}

const CACHE_TTL = 5 * 60 * 1000; // 5분
const dailyCache = new Map<string, { report: DailyReport; restricted: boolean; timestamp: number }>();
const weeklyCache = new Map<string, { report: WeeklySummary; restricted: boolean; timestamp: number }>();

export interface ReportDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportId: string | null;
  reportType: "daily" | "weekly" | null;
  childId?: string | null;
  businessDate?: string | null;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

export function ReportDetailModal({ isOpen, onClose, reportId, reportType, childId, businessDate, returnFocusRef }: ReportDetailModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [activeTab, setActiveTab] = useState(1);

  const [dailyData, setDailyData] = useState<{ report: DailyReport; restricted: boolean } | null>(null);
  const [weeklyData, setWeeklyData] = useState<{ report: WeeklySummary; restricted: boolean } | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  // requests/023 §16.1 — 탭을 전환하면 그 탭 콘텐츠의 최상단을 보여준다(직전 탭의
  // 스크롤 위치가 그대로 남아있으면 안 됨). 콘텐츠 영역만 스크롤되므로 이 ref만 리셋.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [activeTab]);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen || !reportId || !reportType) return;

    let isMounted = true;
    setLoading(true);
    setError(null);
    setDailyData(null);
    setWeeklyData(null);
    setActiveTab(1); // reset to default tab

    const skeletonTimer = setTimeout(() => {
      if (isMounted) setShowSkeleton(true);
    }, 150);

    const loadData = async () => {
      const cacheKey = `${childId ?? "unknown"}-${reportType}-${reportId}`;
      if (reportType === "daily") {
        if (dailyCache.has(cacheKey)) {
          const cached = dailyCache.get(cacheKey)!;
          if (Date.now() - cached.timestamp < CACHE_TTL) {
            setDailyData({ report: cached.report, restricted: cached.restricted });
            setLoading(false);
            clearTimeout(skeletonTimer);
            return;
          } else {
            dailyCache.delete(cacheKey);
          }
        }
        try {
          const res = await fetch(`/api/parent/reports/${reportId}`);
          const d = await res.json();
          if (d.error) throw new Error(d.error);
          
          if (businessDate && d.report.business_date && d.report.business_date !== businessDate) {
            console.error("Report date mismatch", {
              reportId: reportId ? `${reportId.slice(0, 8)}...` : "unknown",
              expectedDate: businessDate,
              apiDate: d.report.business_date,
              childId: childId ? `${childId.slice(0, 8)}...` : "unknown",
              env: typeof window !== "undefined" ? "browser" : "server"
            });
            throw new Error("리포트 날짜를 확인하지 못했어요.\n잠시 후 다시 확인해 주세요.");
          }

          const data = { report: d.report, restricted: Boolean(d.restricted) };
          dailyCache.set(cacheKey, { ...data, timestamp: Date.now() });
          if (isMounted) setDailyData(data);
          
          fetch(`/api/parent/reports/${reportId}/viewed`, { method: "POST" }).catch(() => {});
        } catch (e: any) {
          if (isMounted) setError(e.message || "리포트를 불러오지 못했어요.\n잠시 후 다시 확인해 주세요.");
        } finally {
          if (isMounted) {
            clearTimeout(skeletonTimer);
            setLoading(false);
          }
        }
      } else if (reportType === "weekly") {
        if (weeklyCache.has(cacheKey)) {
          const cached = weeklyCache.get(cacheKey)!;
          if (Date.now() - cached.timestamp < CACHE_TTL) {
            setWeeklyData({ report: cached.report, restricted: cached.restricted });
            setLoading(false);
            clearTimeout(skeletonTimer);
            return;
          } else {
            weeklyCache.delete(cacheKey);
          }
        }
        try {
          const res = await fetch(`/api/parent/reports/weekly/${reportId}`);
          const d = await res.json();
          if (d.error) throw new Error(d.error);
          const data = { report: d.weeklySummary, restricted: Boolean(d.restricted) };
          weeklyCache.set(cacheKey, { ...data, timestamp: Date.now() });
          if (isMounted) setWeeklyData(data);
        } catch (e: any) {
          if (isMounted) setError(e.message || "리포트를 불러오지 못했어요.\n잠시 후 다시 확인해 주세요.");
        } finally {
          if (isMounted) {
            clearTimeout(skeletonTimer);
            setLoading(false);
          }
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
      clearTimeout(skeletonTimer);
    };
  }, [isOpen, reportId, reportType, childId]);

  // Handle modal interactions (body scroll lock, history popstate, escape key, focus)
  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    window.history.pushState({ modal: "report-detail" }, "");

    const handlePopState = (e: PopStateEvent) => {
      onCloseRef.current();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        requestClose();
      } else if (e.key === "Tab") {
        if (!modalRef.current) return;
        const focusableElements = modalRef.current.querySelectorAll(
          'a[href], button, textarea, input[type="text"], input[type="radio"], input[type="checkbox"], select, [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (e.shiftKey) {
          if (document.activeElement === firstElement || document.activeElement === modalRef.current) {
            lastElement?.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === lastElement) {
            firstElement?.focus();
            e.preventDefault();
          }
        }
      }
    };

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("keydown", handleKeyDown);

    // Focus into modal
    modalRef.current?.focus();

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("keydown", handleKeyDown);
      
      // Return focus to original element
      if (returnFocusRef && returnFocusRef.current) {
        returnFocusRef.current.focus();
      }
    };
  }, [isOpen, returnFocusRef]);

  const requestClose = () => {
    if (window.history.state?.modal === "report-detail") {
      window.history.back();
    } else {
      onCloseRef.current();
    }
  };

  if (!mounted) return null;
  if (!isOpen) return null;

  const restricted = reportType === "daily" ? dailyData?.restricted : weeklyData?.restricted;

  const LockedTabNotice = () => (
    <div className="bg-white rounded-2xl px-5 py-10 shadow-sm flex flex-col items-center text-center">
      <p className="text-4xl mb-3">🔒</p>
      <p className="text-sm font-bold mb-2" style={{ color: "var(--color-k-text-primary)" }}>
        상세 내용은 Care Insight로 업그레이드하세요
      </p>
      <p className="text-xs text-gray-400 mb-5">
        Care Start에서는 빠른 요약만 제공돼요. 상세 내용과 추천 가이드는 Insight 이상에서 볼 수 있어요.
      </p>
      <Link
        href="/parent/settings"
        className="px-5 py-2.5 rounded-full text-xs font-bold text-white"
        style={{ background: "var(--color-k-navy)" }}
        onClick={(e) => {
          e.preventDefault();
          if (window.history.state?.modal === "report-detail") {
            // history.back()의 popstate 처리 시점은 스펙상 보장되지 않으므로 고정
            // setTimeout으로 순서를 가정하지 않는다 — popstate를 1회 구독해 실제로
            // 뒤로가기 처리가 끝난 뒤에만 다음 페이지로 이동한다.
            window.addEventListener(
              "popstate",
              () => router.push("/parent/settings"),
              { once: true }
            );
            window.history.back();
          } else {
            onCloseRef.current();
            router.push("/parent/settings");
          }
        }}
      >
        요금제 업그레이드
      </Link>
    </div>
  );

  const renderDailyTab1 = (report: DailyReport) => (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl px-5 py-5" style={{ background: "#fdf1ec" }}>
        <h3 className="font-bold text-base mb-2" style={{ color: "var(--color-k-text-primary)" }}>
          오늘의 한 줄
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: "var(--color-k-text-primary)" }}>
          {report.summary_line || "대화 요약이 준비 중입니다."}
        </p>
        <p className="text-[11px] mt-3" style={{ color: "var(--color-k-orange)" }}>
          AI Insight by 내친구 케이
        </p>
      </div>

      <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
        <h3 className="font-bold text-base mb-2" style={{ color: "var(--color-k-text-primary)" }}>
          📊 1분 요약 리포트
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: "var(--color-k-text-primary)" }}>
          {report.parent_guide || "아이가 보낸 하루 대화에 대한 가이드 조언이 생성되지 않았습니다."}
        </p>
      </div>
    </div>
  );

  const renderDailyTab2 = (report: DailyReport) => {
    const sections = [
      { title: "학교·학원 생활", body: report.school_academy_life },
      { title: "친구 관계와 또래 생활", body: report.peer_friendship },
      { title: "감정 힌트", body: report.emotion_hint },
      { title: "관심사와 개인 취향", body: report.interests_preferences },
      { title: "공부 고민", body: report.study_concerns },
      { title: "디지털 관심사와 콘텐츠 취향", body: report.digital_content_interests },
      { title: "미래·진로·꿈", body: report.future_dreams },
      { title: "선생님·어른", body: report.teacher_adults },
      { title: "반복되는 이야기", body: report.recurring_stories },
    ];

    return (
      <div className="bg-white rounded-2xl px-5 py-5 shadow-sm flex flex-col gap-5">
        <h3 className="font-bold text-base -mb-2" style={{ color: "var(--color-k-text-primary)" }}>
          📄 상세 리포트
        </h3>
        {sections.map((section) => (
          <div key={section.title} className="border-b border-gray-50 last:border-0 pb-3 last:pb-0">
            <h4 className="font-bold text-sm mb-1.5" style={{ color: "var(--color-k-text-primary)" }}>
              {section.title}
            </h4>
            <p className="text-xs leading-relaxed" style={{ color: "#4b5563" }}>
              {section.body || "이 항목은 확인할 대화가 충분하지 않아요."}
            </p>
          </div>
        ))}
      </div>
    );
  };

  const renderDailyTab3 = (report: DailyReport) => {
    // requests/024 §12 — parent_conversation_clue가 없는 과거 리포트는 기존 parent_guide를
    // 부모 대화 실마리로만 표시한다(질문을 임의로 추출하지 않음).
    const clue = report.parent_conversation_clue ?? report.parent_guide;
    const questions = report.recommended_questions ?? [];

    const watchOut = report.recurring_stories || "이 항목은 확인할 대화가 충분하지 않아요.";
    const comment = report.interests_preferences
      ? `오늘 아이는 ${report.interests_preferences} 이야기에 가장 밝게 마음을 열고 대답했습니다.`
      : "이 항목은 확인할 대화가 충분하지 않아요.";

    return (
      <div className="flex flex-col gap-4">
        <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
          <h3 className="font-bold text-base mb-2" style={{ color: "var(--color-k-text-primary)" }}>
            💬 부모 대화 실마리
          </h3>
          <p className="text-sm leading-relaxed" style={{ color: "var(--color-k-text-primary)" }}>
            {clue || "이 항목은 확인할 대화가 충분하지 않아요."}
          </p>
        </div>

        {questions.length > 0 && (
          <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
            <h3 className="font-bold text-base mb-3" style={{ color: "var(--color-k-text-primary)" }}>
              ❓ 부모용 추천 질문
            </h3>
            <ul className="flex flex-col gap-2.5">
              {questions.map((q, i) => (
                <li key={i} className="flex gap-2 text-sm" style={{ color: "var(--color-k-text-primary)" }}>
                  <span style={{ color: "#22c55e" }}>✓</span>
                  <span>{q}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
          <h3 className="font-bold text-base mb-2" style={{ color: "#3b82f6" }}>
            👁️ 부모가 주의 깊게 볼 변화
          </h3>
          <p className="text-sm leading-relaxed" style={{ color: "var(--color-k-text-primary)" }}>
            {watchOut}
          </p>
        </div>

        <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
          <h3 className="font-bold text-base mb-2" style={{ color: "var(--color-k-text-primary)" }}>
            ✨ 오늘의 케이 코멘트
          </h3>
          <p className="text-sm leading-relaxed" style={{ color: "var(--color-k-text-primary)" }}>
            {comment}
          </p>
        </div>
      </div>
    );
  };

  const renderWeeklyTab1 = (report: WeeklySummary) => {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl px-5 py-5" style={{ background: "#fdf1ec" }}>
          <h3 className="font-bold text-base mb-2" style={{ color: "var(--color-k-text-primary)" }}>
            이번 주 요약
          </h3>
          <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "var(--color-k-text-primary)" }}>
            {report.summary_text || "이 항목은 확인할 대화가 충분하지 않아요."}
          </p>
        </div>
        <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
          <h3 className="font-bold text-base mb-2" style={{ color: "var(--color-k-text-primary)" }}>
            주간 감정 상태
          </h3>
          <p className="text-sm leading-relaxed" style={{ color: "var(--color-k-text-primary)" }}>
            {report.mood_average ? moodLabel(report.mood_average) : "이 항목은 확인할 대화가 충분하지 않아요."}
          </p>
        </div>
      </div>
    );
  };

  const renderWeeklyTab2 = (report: WeeklySummary) => {
    const cards = report.detail_dashboard_cards ?? {};
    const sections = [
      { title: "학교·학원 생활", body: cards.school_academy_life },
      { title: "친구 관계", body: cards.peer_friendship },
      { title: "마음 흐름", body: cards.emotion_hint },
      { title: "관심사·취향", body: cards.interests_preferences },
      { title: "공부 고민", body: cards.study_concerns },
      { title: "디지털 관심사", body: cards.digital_content_interests },
      { title: "미래·진로", body: cards.future_dreams },
      { title: "선생님·어른", body: cards.teacher_adults },
      { title: "반복되는 이야기", body: cards.recurring_stories },
    ];
    
    return (
      <div className="flex flex-col gap-4">
        <div className="bg-white rounded-2xl px-5 py-5 shadow-sm flex flex-col gap-4">
          <h3 className="font-bold text-base -mb-1" style={{ color: "var(--color-k-text-primary)" }}>
            📄 이번 주 상세 분석
          </h3>
          <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "var(--color-k-text-primary)" }}>
            {report.detail_text || "이 항목은 확인할 대화가 충분하지 않아요."}
          </p>
        </div>

        <div className="bg-white rounded-2xl px-5 py-5 shadow-sm flex flex-col gap-4">
          {sections.map((section) => (
            <div key={section.title} className="border-b border-gray-50 last:border-0 pb-3 last:pb-0">
              <h4 className="font-bold text-sm mb-1.5" style={{ color: "var(--color-k-text-primary)" }}>
                {section.title}
              </h4>
              <p className="text-xs leading-relaxed" style={{ color: "#4b5563" }}>
                {section.body || "이 항목은 확인할 대화가 충분하지 않아요."}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderWeeklyTab3 = (report: WeeklySummary) => {
    // requests/024 §12/§13 — 일일과 동일하게 신규 필드가 없는 과거 주간 리포트는
    // parent_guide를 실마리로만 표시하고, 질문 카드는 없으면 숨긴다.
    const clue = report.parent_conversation_clue ?? report.parent_guide;
    const questions = report.recommended_questions ?? [];

    return (
      <div className="flex flex-col gap-4">
        <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
          <h3 className="font-bold text-base mb-2" style={{ color: "var(--color-k-text-primary)" }}>
            💬 부모 대화 실마리
          </h3>
          <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "var(--color-k-text-primary)" }}>
            {clue || "이 항목은 확인할 대화가 충분하지 않아요."}
          </p>
        </div>

        {questions.length > 0 && (
          <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
            <h3 className="font-bold text-base mb-3" style={{ color: "var(--color-k-text-primary)" }}>
              ❓ 부모용 추천 질문
            </h3>
            <ul className="flex flex-col gap-2.5">
              {questions.map((q, i) => (
                <li key={i} className="flex gap-2 text-sm" style={{ color: "var(--color-k-text-primary)" }}>
                  <span style={{ color: "#22c55e" }}>✓</span>
                  <span>{q}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
          <h3 className="font-bold text-base mb-2" style={{ color: "var(--color-k-text-primary)" }}>
            🎈 주말 활동 추천
          </h3>
          <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "var(--color-k-text-primary)" }}>
            {report.weekend_activity_recommendation || "이 항목은 확인할 대화가 충분하지 않아요."}
          </p>
        </div>
      </div>
    );
  };

  const renderContent = () => {
    if (loading) {
      if (!showSkeleton) return <div className="flex-1" />;
      return <ReportDetailSkeleton />;
    }

    if (error) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <p className="text-sm font-semibold mb-4 text-red-500 whitespace-pre-line">
            {error}
          </p>
          <button 
            onClick={() => requestClose()}
            className="text-xs underline font-bold" 
            style={{ color: "var(--color-k-navy)" }}
          >
            돌아가기
          </button>
        </div>
      );
    }

    if (reportType === "daily" && dailyData) {
      if (activeTab === 1) return renderDailyTab1(dailyData.report);
      if (restricted) return <LockedTabNotice />;
      if (activeTab === 2) return renderDailyTab2(dailyData.report);
      if (activeTab === 3) return renderDailyTab3(dailyData.report);
    } else if (reportType === "weekly" && weeklyData) {
      if (activeTab === 1) return renderWeeklyTab1(weeklyData.report);
      if (restricted) return <LockedTabNotice />;
      if (activeTab === 2) return renderWeeklyTab2(weeklyData.report);
      if (activeTab === 3) return renderWeeklyTab3(weeklyData.report);
    }

    return null;
  };

  let title = "상세 리포트";
  if (reportType === "daily" && dailyData?.report) {
    const formatted = formatBusinessDate(dailyData.report.business_date);
    title = formatted ? `${formatted} 일간 리포트` : "일간 리포트";
  } else if (reportType === "weekly" && weeklyData?.report) {
    const s = new Date(weeklyData.report.week_start);
    const e = new Date(weeklyData.report.week_end);
    title = `${s.getMonth() + 1}월 ${s.getDate()}일 ~ ${e.getMonth() + 1}월 ${e.getDate()}일 주간 리포트`;
  }

  return (
    <div 
      className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center sm:p-4 bg-black/40 animate-fade-in"
      onClick={requestClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div 
        ref={modalRef}
        tabIndex={-1}
        className="w-full h-[90vh] sm:h-[80vh] sm:max-w-md bg-[#f3f4f6] rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-4 bg-white border-b border-gray-100 shrink-0">
          <h2 id="modal-title" className="text-base font-bold text-gray-800">{title}</h2>
          <button 
            onClick={requestClose}
            className="p-2 -mr-2 text-gray-500 hover:bg-gray-100 rounded-full"
            aria-label="닫기"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {!error && (!loading || showSkeleton) && (
          <div
            className="flex gap-2 px-4 py-3 overflow-x-auto shrink-0 bg-white border-b border-gray-100 sticky top-0 z-10"
          >
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 px-4 py-2.5 rounded-xl text-xs font-bold text-left transition-colors cursor-pointer`}
                style={{
                  background: activeTab === tab.id ? "var(--color-k-navy)" : "#ffffff",
                  color: activeTab === tab.id ? "#ffffff" : "var(--color-k-text-primary)",
                }}
                role="tab"
                aria-selected={activeTab === tab.id}
              >
                {tab.id !== 1 && restricted ? `🔒 ${tab.label}` : tab.label}
              </button>
            ))}
          </div>
        )}

        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <div className="px-4 py-4">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
