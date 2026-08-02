"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { ReportDetailModal } from "@/components/ReportDetailModal";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealParentNav } from "@/components/RealParentNav";
import { ParentHeader } from "@/components/ParentHeader";
import { SkeletonBox } from "@/components/Skeleton";
import { useStore } from "@/hooks/useStore";
import KChatbotWidget from "@/components/KChatbotWidget";
import { ReportHistoryCalendarSheet } from "./components/ReportHistoryCalendarSheet";

interface Report {
  id: string;
  summary_line: string;
  mood_score: number;
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

  const handleOpenModal = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    lastClickedCardRef.current = e.currentTarget as HTMLElement;
    setSelectedReportId(id);
    setModalOpen(true);
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
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          <SkeletonBox className="h-28 rounded-2xl" />
          <div className="py-2" />
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonBox key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col items-center justify-center">
          <p className="text-sm font-semibold text-gray-600 mb-2">일간 리포트를 불러오지 못했어요.</p>
          <p className="text-xs text-gray-400 mb-4">잠시 후 다시 시도해 주세요.</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 bg-gray-200 rounded-full text-xs font-bold text-gray-600 active:bg-gray-300">
            재시도
          </button>
        </div>
      );
    }

    let diffText = "이전 7일과 비슷해요";
    if (summary) {
      if (summary.recentCount > summary.prevCount) {
        diffText = `이전 7일 ${summary.prevCount}회보다 증가`;
      } else if (summary.recentCount < summary.prevCount) {
        diffText = `이전 7일보다 ${summary.prevCount - summary.recentCount}회 적어요`;
      }
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
          renderedList.push(<h3 key={`month-${m}-${index}`} className="text-sm font-bold text-[#10315B] mt-4 mb-2 ml-1">{m}</h3>);
          lastMonth = m;
        }
        
        const rel = formatRelative(item.date);
        
        renderedList.push(
          <button
            key={`report-${item.date}`}
            onClick={(e) => handleOpenModal(e, item.report.id)}
            className="block w-full text-left bg-white rounded-[16px] p-[16px] active:scale-[0.99] transition-transform shadow-sm border border-gray-200 mb-3"
          >
            <p className="text-[12px] text-gray-500 mb-2 sm:hidden">
              {formatDateShort(item.date)} · {rel}
            </p>
            <p className="text-[12px] text-gray-500 mb-2 hidden sm:block">
              {formatDateFull(item.date)} · {rel}
            </p>
            <p className="text-[14px] font-bold text-[#10315B] mb-1">
              <span className="text-[#4298D3] mr-1.5">●</span>
              {item.report.emotion_hint || item.report.summary_line}
            </p>
            {(!item.report.emotion_hint || item.report.emotion_hint !== item.report.summary_line) && (
              <p className="text-[14px] text-gray-800 leading-snug line-clamp-2">
                {item.report.summary_line}
              </p>
            )}
          </button>
        );
      } else if (item.type === 'gap') {
        const m = getMonthHeading(item.dates[0].date); // Most recent date in gap
        if (m !== lastMonth) {
          renderedList.push(<h3 key={`month-${m}-${index}`} className="text-sm font-bold text-[#10315B] mt-4 mb-2 ml-1">{m}</h3>);
          lastMonth = m;
        }
        
        const oldest = formatDateShort(item.dates[item.dates.length - 1].date);
        const newest = formatDateShort(item.dates[0].date);
        const dateStr = item.dates.length > 1 ? `${oldest.replace('일','')}~${newest}` : oldest;
        
        const hasSession = item.dates[0].hasSession;
        const gapText = hasSession ? "리포트 준비 중" : "대화 없음";
        
        renderedList.push(
          <div key={`gap-${item.dates[0].date}`} className="flex justify-center items-center py-2 mb-3">
            <span className="text-xs font-semibold text-gray-400 bg-[#f3f4f6] px-4 py-1.5 rounded-full border border-gray-100">
              {dateStr} · {gapText}
            </span>
          </div>
        );
      }
    });

    const hasAnyReport = reports.length > 0;
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
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col">
        {summary && (
          <div className="bg-white rounded-[16px] p-4 shadow-sm border border-gray-200 mb-4">
            <div className="flex justify-between items-start mb-2">
              <h2 className="text-[14px] font-bold text-[#10315B]">최근 7일</h2>
              <span className="text-[14px] font-bold text-gray-800">{summary.recentCount}회</span>
            </div>
            <p className="text-[12px] text-gray-500 mb-4">{diffText}</p>
            
            <div className="flex justify-between items-center px-1">
              {summary.dates.map((d, i) => {
                const dateObj = new Date(d.date + "T00:00:00+09:00");
                const dow = ["일", "월", "화", "수", "목", "금", "토"][dateObj.getDay()];
                const isToday = i === 6;
                
                let dotColor = "text-gray-200";
                let ariaLabel = "리포트 없음";
                if (d.hasReport) {
                  dotColor = "text-[#4298D3]"; // K-Sky Blue
                  ariaLabel = "리포트 있음";
                } else if (d.hasSession) {
                  dotColor = "text-[#F19122]"; // K-Mascot Orange
                  ariaLabel = "리포트 준비 중";
                }
                
                return (
                  <div key={d.date} className="flex flex-col items-center gap-1.5" aria-label={`${dow}요일, ${ariaLabel}${isToday ? ", 오늘" : ""}`}>
                    <span className={`text-[10px] font-bold ${isToday ? "text-[#10315B]" : "text-gray-400"}`}>{dow}</span>
                    <span className={`text-xs ${dotColor}`}>{d.hasReport || d.hasSession ? "●" : "○"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {renderedList}
        
        <div className="mt-4 mb-6 flex justify-center">
          <button
            onClick={() => setIsCalendarOpen(true)}
            className="flex items-center gap-1 text-[13px] font-bold text-[#10315B] px-4 py-2 active:bg-gray-200 rounded-full transition-colors"
          >
            지난 이력 보기<span className="text-[10px]">⌄</span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
        <ParentHeader />

        <div className="flex items-center gap-2 px-4 pt-3 pb-1 shrink-0">
          <span className="text-xs font-bold px-3 py-1.5 rounded-full text-white" style={{ background: "var(--color-k-navy, #10315B)" }} aria-selected="true" role="tab">
            일간
          </span>
          <Link href="/parent/report/weekly" className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white text-gray-500" aria-selected="false" role="tab">
            주간
          </Link>
        </div>

        {renderContent()}

        <RealParentNav active="리포트" />
      </div>
      
      {activeChildId && (
        <ReportHistoryCalendarSheet
          childId={activeChildId}
          isOpen={isCalendarOpen}
          onClose={() => setIsCalendarOpen(false)}
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
