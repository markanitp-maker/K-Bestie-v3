"use client";

import { useState, useEffect, useRef } from "react";
import { ReportDetailModal } from "@/components/ReportDetailModal";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealParentNav } from "@/components/RealParentNav";
import { ParentHeader } from "@/components/ParentHeader";
import { SkeletonBox } from "@/components/Skeleton";
import { useStore } from "@/hooks/useStore";
import KChatbotWidget from "@/components/KChatbotWidget";
import { ReportPeriodTabs } from "@/components/parent/report/ReportPeriodTabs";
import { CurrentWeekAggregationCard } from "./components/CurrentWeekAggregationCard";
import { WeeklyReportCard, WeeklyReportSummary } from "./components/WeeklyReportCard";
import { WeeklyHistoryCalendarSheet } from "./components/WeeklyHistoryCalendarSheet";

interface CurrentAggregation {
  week_start: string;
  week_end: string;
  currentDayIndex: number;
  currentConversationCount: number;
  expectedCompletionLabel: string;
}

export default function ParentWeeklyReportPage() {
  const store = useStore();
  const activeChildId = store.activeChildId ?? store.children[0]?.id ?? null;
  
  const [currentAggregation, setCurrentAggregation] = useState<CurrentAggregation | null>(null);
  const [weeklies, setWeeklies] = useState<WeeklyReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const lastClickedCardRef = useRef<HTMLElement | null>(null);
  const calendarTriggerRef = useRef<HTMLButtonElement | null>(null);

  const handleOpenModal = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    lastClickedCardRef.current = e.currentTarget as HTMLElement;
    setSelectedReportId(id);
    setModalOpen(true);
  };

  // requests/021 §9 — 달력 바텀시트를 먼저 닫고 다음 프레임에서 상세 모달을 연다.
  const handleSelectReportFromCalendar = (reportId: string) => {
    setIsCalendarOpen(false);
    lastClickedCardRef.current = calendarTriggerRef.current;
    requestAnimationFrame(() => {
      setSelectedReportId(reportId);
      setModalOpen(true);
    });
  };

  useEffect(() => {
    if (!activeChildId) {
      setLoading(false);
      return;
    }
    
    const controller = new AbortController();
    setLoading(true);
    
    fetch(`/api/parent/reports/weekly?childId=${activeChildId}&type=list`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setCurrentAggregation(d.currentAggregation ?? null);
          setWeeklies(d.weeklySummaries ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
      
    return () => controller.abort();
  }, [activeChildId]);

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--color-k-surface)" }}>
        <ParentHeader />

        <div className="shrink-0">
          <ReportPeriodTabs activePeriod="weekly" />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-5 pb-7">
          <div className="w-full max-w-[var(--max-width-app)] mx-auto flex flex-col">
          {loading ? (
            <div className="flex flex-col gap-3">
              <SkeletonBox className="h-24 rounded-[16px]" />
              <SkeletonBox className="h-32 rounded-[16px]" />
              <div className="grid grid-cols-2 gap-3 mt-1">
                <SkeletonBox className="h-40 rounded-[16px]" />
                <SkeletonBox className="h-40 rounded-[16px]" />
              </div>
            </div>
          ) : (
            <>
              {currentAggregation && <CurrentWeekAggregationCard data={currentAggregation} />}
              
              {weeklies.length > 0 ? (
                <>
                  <WeeklyReportCard report={weeklies[0]} isFeatured={true} isLastWeek={true} onClick={handleOpenModal} />
                  
                  {weeklies.length > 1 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
                      {weeklies.slice(1).map(w => (
                        <WeeklyReportCard key={w.id} report={w} isFeatured={false} onClick={handleOpenModal} />
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-10 bg-white rounded-[16px] shadow-sm border border-gray-100 mb-6">
                  <p className="text-sm font-semibold text-gray-600 mb-1">아직 완성된 주간 리포트가 없어요.</p>
                  <p className="text-xs text-gray-400">이번 주 대화가 모이면 확인할 수 있어요.</p>
                </div>
              )}

              <div className="mt-4 mb-6 flex justify-center">
                <button
                  ref={calendarTriggerRef}
                  onClick={() => setIsCalendarOpen(true)}
                  className="flex items-center gap-1 text-[13px] font-bold text-[var(--color-k-navy)] px-4 py-2 active:bg-gray-200 rounded-full transition-colors"
                >
                  지난 기록 보기<span className="text-[10px]">⌄</span>
                </button>
              </div>
            </>
          )}
          </div>
        </div>

        <RealParentNav active="리포트" />
      </div>
    
      {activeChildId && (
        <WeeklyHistoryCalendarSheet
          childId={activeChildId}
          isOpen={isCalendarOpen}
          onClose={() => setIsCalendarOpen(false)}
          onSelectReport={handleSelectReportFromCalendar}
        />
      )}
      
      <ReportDetailModal 
        isOpen={modalOpen} 
        onClose={() => setModalOpen(false)} 
        reportId={selectedReportId} 
        reportType="weekly"
        childId={activeChildId}
        returnFocusRef={lastClickedCardRef}
      />
      <KChatbotWidget appSurface="parent" />
    </DemoFrame>
  );
}
