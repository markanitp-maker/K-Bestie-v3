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
  emotion_hint?: string;
  business_date: string;
}

function formatBusinessDate(dateStr: string) {
  const [, month, day] = dateStr.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
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

function getKstDateString() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function getCurrentWeekDates() {
  const today = getKstDateString();
  const currentDate = new Date(`${today}T00:00:00Z`);
  const daysSinceSaturday = (currentDate.getUTCDay() + 1) % 7;
  currentDate.setUTCDate(currentDate.getUTCDate() - daysSinceSaturday);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(currentDate);
    date.setUTCDate(currentDate.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}



export default function ParentReportPage() {
  const store = useStore();
  const activeChildId = store.activeChildId ?? store.children[0]?.id ?? null;
  const [reports, setReports] = useState<Report[]>([]);
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
    setError(false);
    
    fetch(`/api/parent/report-history?childId=${activeChildId}&recent=true`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setReports(data.reports || []);
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
          <div className="w-full max-w-[var(--content-max-width,var(--max-width-app,480px))] mx-auto flex flex-col gap-3">
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
          <div className="w-full max-w-[var(--content-max-width,var(--max-width-app,480px))] mx-auto flex flex-col items-center justify-center">
            <p className="text-sm font-semibold text-gray-600 mb-2">일간 리포트를 불러오지 못했어요.</p>
            <p className="text-xs text-gray-400 mb-4">잠시 후 다시 시도해 주세요.</p>
            <button onClick={() => window.location.reload()} className="px-4 py-2 bg-gray-200 rounded-full text-xs font-bold text-gray-600 active:bg-gray-300">
              재시도
            </button>
          </div>
        </div>
      );
    }

    const reportDates = new Set(reports.map((report) => report.business_date));
    const weekDates = getCurrentWeekDates();
    const weekdays = ["토", "일", "월", "화", "수", "목", "금"];

    return (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 pb-8">
        <div className="w-full max-w-[var(--content-max-width,var(--max-width-app,480px))] mx-auto flex flex-col">
          <section className="mb-6 rounded-[24px] border border-gray-200 bg-white p-5 shadow-sm sm:p-6" aria-label="이번 주 리포트 요약">
            <h2 className="mb-6 text-xl font-extrabold text-[var(--color-k-navy)]">이번 주 리포트</h2>
            <div className="grid grid-cols-7 gap-1">
              {weekDates.map((date, index) => {
                const hasReport = reportDates.has(date);
                const weekday = weekdays[index];

                return (
                  <div key={date} className="flex min-w-0 flex-col items-center gap-2.5" aria-label={`${weekday}요일, ${hasReport ? "리포트 있음" : "리포트 없음"}`}>
                    <span className="text-sm font-extrabold text-gray-500">{weekday}</span>
                    <span className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-base font-extrabold ${
                      hasReport
                        ? "border-[var(--color-k-sky-blue)] bg-[var(--color-k-sky-blue)] text-white"
                        : "border-gray-200 bg-white text-transparent"
                    }`}>{hasReport ? "✓" : "○"}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {reports.map((report) => (
            <button
              key={report.id}
              onClick={(event) => handleOpenModal(event, report.id)}
              className="mb-6 block w-full rounded-[24px] border border-gray-200 bg-white p-5 text-left shadow-sm transition-transform active:scale-[0.99] sm:p-6"
            >
              <div className="mb-5 flex items-start justify-between gap-3">
                <p className="text-2xl font-extrabold leading-8 text-[var(--color-k-navy)]">{formatBusinessDate(report.business_date)}</p>
                <span className="shrink-0 rounded-full bg-[var(--color-k-info-bg)] px-3 py-1.5 text-[13px] font-bold text-[var(--color-k-text-secondary)]">{formatRelative(report.business_date)}</span>
              </div>
              {report.emotion_hint && (
                <p className="whitespace-pre-line break-words text-lg leading-8 text-gray-800">
                  {report.emotion_hint}
                </p>
              )}
              {report.summary_line && report.summary_line !== report.emotion_hint && (
                <p className="mt-4 whitespace-pre-line break-words text-lg leading-8 text-gray-800">
                  {report.summary_line}
                </p>
              )}
              <span className="mt-4 flex min-h-12 items-center justify-end text-base font-extrabold text-[var(--color-k-navy)]">자세히 보기 &gt;</span>
            </button>
          ))}
          
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
