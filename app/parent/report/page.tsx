"use client";

import React, { useState, useEffect, useRef } from "react";
import { ReportDetailModal } from "@/components/ReportDetailModal";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealParentNav } from "@/components/RealParentNav";
import { ParentHeader } from "@/components/ParentHeader";
import { SkeletonBox } from "@/components/Skeleton";
import { useStore } from "@/hooks/useStore";
import KChatbotWidget from "@/components/KChatbotWidget";
import { ReportPeriodTabs } from "@/components/parent/report/ReportPeriodTabs";
import { ReportHistoryCalendarSheet } from "./components/ReportHistoryCalendarSheet";

interface Report {
  id: string;
  summary_line: string;
  mood_score: number | null;
  emotion_hint?: string;
  business_date: string;
}

interface SummaryDate {
  date: string;
  hasReport: boolean;
  hasSession: boolean;
}

interface Summary {
  recentCount: number;
  prevCount: number;
  dates: SummaryDate[];
}

function formatDateFull(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00+09:00");
  const dd = d.getDate();
  const dow = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${dd}일 ${dow}요일`;
}

function formatDateShort(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00+09:00");
  const dd = d.getDate();
  return `${dd}일`;
}

function formatRelative(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00+09:00");
  const now = new Date();
  const kstTime = now.getTime() + (9 * 60 * 60 * 1000);
  const kstNow = new Date(kstTime);
  // Compare just the YYYY-MM-DD
  const todayStr = kstNow.toISOString().split("T")[0];
  const todayDate = new Date(todayStr + "T00:00:00+09:00");
  const diffTime = todayDate.getTime() - d.getTime();
  const diffDays = Math.round(diffTime / (1000 * 3600 * 24));
  
  if (diffDays === 0) return "오늘";
  if (diffDays === 1) return "어제";
  return `${diffDays}일 전`;
}

function getMonthHeading(dateStr: string) {
  const [y, m] = dateStr.split("-");
  return `${parseInt(m, 10)}월`;
}

function getMoodEmoji(score: number | null | undefined) {
  if (typeof score !== "number" || !Number.isFinite(score)) return "💬";
  if (score >= 8) return "😊";
  if (score >= 6) return "🙂";
  if (score >= 4) return "😐";
  return "😟";
}



export default function ParentReportPage() {
  const store = useStore();
  const activeChildId = store.activeChildId ?? store.children[0]?.id ?? null;
  const [reports, setReports] = useState<Report[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
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

  // requests/021 §9 — 달력 바텀시트를 먼저 닫고, 닫힘이 상태에 반영된 다음
  // 프레임에서 상세 모달을 연다(같은 프레임에 겹쳐 그려지는 것을 방지).
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
    setReports([]);
    setSummary(null);
    setError(false);
    
    fetch(`/api/parent/report-history?childId=${activeChildId}&recent=true`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setReports(data.reports || []);
        setSummary(data.summary || null);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError(true);
        setLoading(false);
      });
      
    return () => controller.abort();
  }, [activeChildId]);

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
          <div className="w-full max-w-[var(--max-width-app)] mx-auto flex flex-col gap-3">
            <SkeletonBox className="h-44 rounded-[24px]" />
            <div className="py-2" />
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonBox key={i} className="h-52 rounded-[24px]" />
            ))}
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
          <div className="w-full max-w-[var(--max-width-app)] mx-auto flex flex-col items-center justify-center">
            <p className="text-sm font-semibold text-gray-600 mb-2">일간 리포트를 불러오지 못했어요.</p>
            <p className="text-xs text-gray-400 mb-4">잠시 후 다시 시도해 주세요.</p>
            <button onClick={() => window.location.reload()} className="px-4 py-2 bg-gray-200 rounded-full text-xs font-bold text-gray-600 active:bg-gray-300">
              재시도
            </button>
          </div>
        </div>
      );
    }

    type ListItem = 
      | { type: 'report'; date: string; report: Report }
      | { type: 'gap'; dates: SummaryDate[] };

    const listItems: ListItem[] = [];
    let currentGap: SummaryDate[] = [];
    
    if (summary && summary.dates) {
      const reversedDates = [...summary.dates].reverse();
      for (let i = 0; i < reversedDates.length; i++) {
        const d = reversedDates[i];
        if (d.hasReport) {
          if (currentGap.length > 0) {
            listItems.push({ type: 'gap', dates: currentGap });
            currentGap = [];
          }
          const report = reports.find((r) => r.business_date === d.date);
          if (report) {
            listItems.push({ type: 'report', date: d.date, report });
          }
        } else {
          if (currentGap.length > 0 && currentGap[0].hasSession !== d.hasSession) {
            listItems.push({ type: 'gap', dates: currentGap });
            currentGap = [];
          }
          currentGap.push(d);
        }
      }
      if (currentGap.length > 0) {
        listItems.push({ type: 'gap', dates: currentGap });
      }
    }

    let lastMonth = '';
    const renderedList: React.ReactNode[] = [];

    listItems.forEach((item, index) => {
      if (item.type === 'report') {
        const m = getMonthHeading(item.date);
        if (m !== lastMonth) {
          renderedList.push(<h3 key={`month-${m}-${index}`} className="mb-3 ml-1 mt-7 text-xl font-extrabold text-[var(--color-k-navy)]">{m}</h3>);
          lastMonth = m;
        }
        
        const rel = formatRelative(item.date);
        
        renderedList.push(
          <button
            key={`report-${item.date}`}
            onClick={(e) => handleOpenModal(e, item.report.id)}
            className="mb-6 block w-full rounded-[24px] border border-gray-200 bg-white p-5 text-left shadow-sm transition-transform active:scale-[0.99] sm:p-6"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <p className="text-2xl font-extrabold leading-8 text-[var(--color-k-navy)] sm:hidden">{formatDateShort(item.date)}</p>
              <p className="hidden text-2xl font-extrabold leading-8 text-[var(--color-k-navy)] sm:block">{formatDateFull(item.date)}</p>
              <span className="shrink-0 rounded-full bg-[var(--color-k-info-bg)] px-3 py-1.5 text-[13px] font-bold text-[var(--color-k-text-secondary)]">{rel}</span>
            </div>
            <div className="mb-4 flex min-w-0 items-center gap-3">
              <div className="flex min-w-0 flex-1 items-start gap-2.5 rounded-[16px] bg-[var(--color-k-navy-tint)] px-4 py-3">
                <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--color-k-sky-blue)]" aria-hidden="true" />
                <span className="shrink-0 text-2xl leading-7" aria-hidden="true">{getMoodEmoji(item.report.mood_score)}</span>
                <span className="min-w-0 break-words text-lg font-extrabold leading-7 text-[var(--color-k-navy)]">
                  {item.report.emotion_hint || "오늘의 마음"}
                </span>
              </div>
              {Number.isFinite(item.report.mood_score) && (
                <span className="shrink-0 text-base font-extrabold text-[var(--color-k-text-secondary)]">{item.report.mood_score}점</span>
              )}
            </div>
            {item.report.summary_line && item.report.emotion_hint !== item.report.summary_line && (
              <p className="whitespace-pre-line break-words text-lg leading-8 text-gray-800">
                {item.report.summary_line}
              </p>
            )}
            <span className="mt-4 flex min-h-12 items-center justify-end text-base font-extrabold text-[var(--color-k-navy)]">자세히 보기 &gt;</span>
          </button>
        );
      } else if (item.type === 'gap') {
        const m = getMonthHeading(item.dates[0].date); // Most recent date in gap
        if (m !== lastMonth) {
          renderedList.push(<h3 key={`month-${m}-${index}`} className="mb-3 ml-1 mt-7 text-xl font-extrabold text-[var(--color-k-navy)]">{m}</h3>);
          lastMonth = m;
        }
        
        const oldest = formatDateShort(item.dates[item.dates.length - 1].date);
        const newest = formatDateShort(item.dates[0].date);
        const dateStr = item.dates.length > 1 ? `${oldest.replace('일','')}~${newest}` : oldest;
        
        const hasSession = item.dates[0].hasSession;
        const gapText = hasSession ? "리포트 준비 중" : "대화 없음";
        
        renderedList.push(
          <div key={`gap-${item.dates[0].date}`} className="flex justify-center items-center py-2 mb-5">
            <span className="text-sm font-semibold text-gray-500 bg-[var(--color-k-surface)] px-4 py-2 rounded-full border border-gray-100">
              {dateStr} · {gapText}
            </span>
          </div>
        );
      }
    });

    const hasAnyReport = reports.length > 0;
    const conversationDayCount = summary?.dates.filter((date) => date.hasSession).length ?? 0;
    if (summary && !hasAnyReport) {
       renderedList.length = 0;
       renderedList.push(
         <div key="empty" className="text-center py-12">
            <p className="text-sm font-semibold text-gray-600 mb-1">최근 7일 동안 생성된 일간 리포트가 없어요.</p>
            <p className="text-xs text-gray-400">아이가 케이와 이야기를 나누면 이곳에서 확인할 수 있어요.</p>
         </div>
       );
    }

    return (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 pb-8">
        <div className="w-full max-w-[var(--max-width-app)] mx-auto flex flex-col">
          {summary && (
            <section className="mb-6 rounded-[24px] border border-gray-200 bg-white p-5 shadow-sm sm:p-6" aria-label="이번 주 대화 요약">
            <div className="mb-6 flex items-end justify-between gap-4">
              <h2 className="pb-1 text-xl font-extrabold text-[var(--color-k-navy)]">이번 주 대화</h2>
              <p className="text-[52px] font-extrabold leading-none tracking-[-0.04em] text-[var(--color-k-navy)]">{conversationDayCount}<span className="ml-1 text-2xl tracking-normal">일</span></p>
            </div>

            <div className="grid grid-cols-7 gap-1">
              {summary.dates.map((d, i) => {
                const dateObj = new Date(d.date + "T00:00:00+09:00");
                const dow = ["일", "월", "화", "수", "목", "금", "토"][dateObj.getDay()];
                const isToday = i === 6;
                
                let ariaLabel = "리포트 없음";
                if (d.hasReport) {
                  ariaLabel = "리포트 있음";
                } else if (d.hasSession) {
                  ariaLabel = "리포트 준비 중";
                }
                
                return (
                  <div key={d.date} className="flex min-w-0 flex-col items-center gap-2.5" aria-label={`${dow}요일, ${ariaLabel}${isToday ? ", 오늘" : ""}`}>
                    <span className={`text-sm font-extrabold ${isToday ? "text-[var(--color-k-navy)]" : "text-gray-500"}`}>{dow}</span>
                    <span className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-base font-extrabold ${
                      d.hasReport
                        ? "border-[var(--color-k-sky-blue)] bg-[var(--color-k-sky-blue)] text-white"
                        : d.hasSession
                          ? "border-[var(--color-k-mascot-orange)] bg-[var(--color-k-mascot-orange)] text-white"
                          : "border-gray-200 bg-white text-transparent"
                    }`}>{d.hasReport || d.hasSession ? "✓" : "○"}</span>
                  </div>
                );
              })}
            </div>
          </section>
            )}
          
          {renderedList}
          
          <div className="mt-4 mb-6 flex justify-center">
          <button
            ref={calendarTriggerRef}
            onClick={() => setIsCalendarOpen(true)}
            className="flex items-center gap-1 text-[13px] font-bold text-[var(--color-k-navy)] px-4 py-2 active:bg-gray-200 rounded-full transition-colors"
          >
            지난 이력 보기<span className="text-[10px]">⌄</span>
          </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--color-k-surface)" }}>
        <ParentHeader />

        <div className="shrink-0">
          <ReportPeriodTabs activePeriod="daily" />
        </div>

        {renderContent()}

        <RealParentNav active="리포트" />
      </div>
      
      {activeChildId && (
        <ReportHistoryCalendarSheet
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
        reportType="daily"
        childId={activeChildId}
        returnFocusRef={lastClickedCardRef}
      />
      <KChatbotWidget appSurface="parent" />
    </DemoFrame>
  );
}
