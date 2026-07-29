"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealParentNav } from "@/components/RealParentNav";
import { ParentHeader } from "@/components/ParentHeader";
import { SkeletonBox } from "@/components/Skeleton";
import { useStore } from "@/hooks/useStore";
import KChatbotWidget from "@/components/KChatbotWidget";
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
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
        <ParentHeader />

        <div className="flex items-center gap-2 px-4 pt-3 pb-1 shrink-0">
          <Link href="/parent/report" className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white text-gray-500" aria-selected="false" role="tab">
            일간
          </Link>
          <span className="text-xs font-bold px-3 py-1.5 rounded-full text-white" style={{ background: "var(--color-k-navy, #10315B)" }} aria-selected="true" role="tab">
            주간
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col">
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
                  <WeeklyReportCard report={weeklies[0]} isFeatured={true} isLastWeek={true} />
                  
                  {weeklies.length > 1 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                      {weeklies.slice(1).map(w => (
                        <WeeklyReportCard key={w.id} report={w} isFeatured={false} />
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
                  onClick={() => setIsCalendarOpen(true)}
                  className="flex items-center gap-1 text-[13px] font-bold text-[#10315B] px-4 py-2 active:bg-gray-200 rounded-full transition-colors"
                >
                  지난 기록 보기<span className="text-[10px]">⌄</span>
                </button>
              </div>
            </>
          )}
        </div>

        <RealParentNav active="리포트" />
      </div>
    
      {activeChildId && (
        <WeeklyHistoryCalendarSheet
          childId={activeChildId}
          isOpen={isCalendarOpen}
          onClose={() => setIsCalendarOpen(false)}
        />
      )}
      
      <KChatbotWidget appSurface="parent" />
    </DemoFrame>
  );
}
