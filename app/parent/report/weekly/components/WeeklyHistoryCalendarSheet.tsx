import React, { useState, useEffect, useRef } from "react";
import { WeeklyReportSummary, getStateColor } from "./WeeklyReportCard";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface WeeklyHistoryCalendarSheetProps {
  childId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function WeeklyHistoryCalendarSheet({ childId, isOpen, onClose }: WeeklyHistoryCalendarSheetProps) {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [weeklies, setWeeklies] = useState<WeeklyReportSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  // §21: ESC 닫기, 뒤쪽 화면 스크롤 잠금, 닫힌 뒤 "지난 기록 보기" 버튼(연 시점의 포커스)으로 복귀.
  useEffect(() => {
    if (!isOpen) return;

    triggerRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      triggerRef.current?.focus?.();
    };
  }, [isOpen, onClose]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1; // 1-indexed

  useEffect(() => {
    if (!isOpen) return;

    const controller = new AbortController();
    setLoading(true);
    setError(false);

    fetch(`/api/parent/reports/weekly?type=calendar&childId=${childId}&year=${year}&month=${month}`, {
      signal: controller.signal
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setWeeklies(data.weeklySummaries || []);
        setLoading(false);
      })
      .catch(err => {
        if (err.name === "AbortError") return;
        setError(true);
        setLoading(false);
      });

    return () => controller.abort();
  }, [isOpen, childId, year, month]);

  if (!isOpen) return null;

  const handlePrevMonth = () => {
    setCurrentDate(prev => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() - 1);
      return d;
    });
  };

  const handleNextMonth = () => {
    setCurrentDate(prev => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + 1);
      const now = new Date();
      if (d > now) return prev; // prevent future month
      return d;
    });
  };

  // Generate weeks for the currently displayed month.
  // A week in the calendar is any week whose `week_end` (Friday) falls in this month.
  // We can just iterate from the 1st of the month to the last day, finding Fridays.
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);

  const weeksInMonth = [];
  for (let day = 1; day <= lastDay.getDate(); day++) {
    const d = new Date(year, month - 1, day);
    if (d.getDay() === 5) { // Friday
      const fridayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      
      const sat = new Date(d);
      sat.setDate(d.getDate() - 6);
      const satStr = `${sat.getFullYear()}-${String(sat.getMonth() + 1).padStart(2, '0')}-${String(sat.getDate()).padStart(2, '0')}`;
      
      weeksInMonth.push({
        weekStart: satStr,
        weekEnd: fridayStr,
        satDate: sat.getDate(),
        friDate: d.getDate()
      });
    }
  }

  const isFutureMonth = () => {
    const next = new Date(currentDate);
    next.setMonth(next.getMonth() + 1);
    return next > new Date();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="weekly-calendar-sheet-title"
        className="relative w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[85vh]"
      >
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1.5 bg-gray-300 rounded-full" />
        </div>

        <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
          <button onClick={handlePrevMonth} className="p-2 text-gray-500 hover:bg-gray-100 rounded-full">
            &larr;
          </button>
          <h2 id="weekly-calendar-sheet-title" className="text-[16px] font-bold text-[#10315B]">
            {year}년 {month}월
          </h2>
          <div className="flex items-center">
            <button 
              onClick={handleNextMonth} 
              disabled={isFutureMonth()} 
              className={`p-2 rounded-full ${isFutureMonth() ? 'text-gray-300' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              &rarr;
            </button>
            <button onClick={onClose} className="p-2 ml-2 text-gray-500 hover:bg-gray-100 rounded-full">
              &#10005;
            </button>
          </div>
        </div>
        
        <div className="px-4 py-2 border-b border-gray-100">
          <div className="grid grid-cols-7 text-center">
            {["토", "일", "월", "화", "수", "목", "금"].map(d => (
              <div key={d} className="text-[12px] font-bold text-gray-400">{d}</div>
            ))}
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto px-4 py-4 min-h-[300px]">
          {loading ? (
            <div className="flex justify-center py-10"><div className="animate-pulse w-8 h-8 rounded-full bg-gray-200"></div></div>
          ) : error ? (
            <div className="text-center py-10">
              <p className="text-sm font-semibold text-gray-600 mb-2">지난 주간 기록을 불러오지 못했어요.</p>
              <button onClick={() => setCurrentDate(new Date(currentDate))} className="px-4 py-2 bg-gray-200 rounded-full text-xs font-bold text-gray-600">재시도</button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {weeksInMonth.map((w, i) => {
                const report = weeklies.find(r => r.week_end === w.weekEnd);
                
                // Get the dates for the whole week to render the row
                const dates = [];
                for(let j=0; j<7; j++) {
                  const d = new Date(w.weekStart + "T00:00:00Z");
                  d.setUTCDate(d.getUTCDate() + j);
                  const isCurrentMonth = (d.getUTCMonth() + 1) === month;
                  dates.push({
                    day: d.getUTCDate(),
                    isCurrentMonth
                  });
                }

                if (report) {
                  return (
                    <button
                      key={w.weekStart}
                      onClick={() => {
                        onClose();
                        router.push(`/parent/report/weekly/${report.id}`);
                      }}
                      className="group grid grid-cols-7 items-center border border-gray-200 rounded-[12px] py-2 hover:bg-[#f0f9ff] hover:border-[#bae6fd] hover:shadow-sm transition-all focus:outline-none focus:bg-[#f0f9ff] focus:border-[#bae6fd] focus:ring-1 focus:ring-[#bae6fd]"
                      aria-label={`${year}년 ${month}월 ${dates[0].day}일부터 ${dates[6].day}일까지, 주간 리포트 있음, ${report.summary_state}`}
                    >
                      {dates.map((dObj, j) => (
                        <div key={j} className="flex flex-col items-center justify-center relative h-8">
                          <span className={`text-[14px] font-semibold ${dObj.isCurrentMonth ? "text-gray-800" : "text-gray-300"}`}>
                            {dObj.day}
                          </span>
                          {j === 6 && (
                            <div className="absolute -bottom-1">
                              <span className="text-[10px]" style={{ color: getStateColor(report.summary_state) }}>●</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </button>
                  );
                } else {
                  return (
                    <div
                      key={w.weekStart}
                      className="grid grid-cols-7 items-center border border-gray-100 bg-gray-50 rounded-[12px] py-2 opacity-60"
                      aria-label={`${year}년 ${month}월 ${dates[0].day}일부터 ${dates[6].day}일까지, 주간 리포트 없음`}
                    >
                      {dates.map((dObj, j) => (
                        <div key={j} className="flex flex-col items-center justify-center h-8">
                          <span className={`text-[14px] font-semibold ${dObj.isCurrentMonth ? "text-gray-500" : "text-gray-300"}`}>
                            {dObj.day}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                }
              })}
            </div>
          )}
        </div>
        
        <div className="px-4 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl sm:rounded-b-2xl">
          <p className="text-center text-[13px] font-bold text-[#10315B] mb-1">
            {month}월 · 주간 리포트 {weeklies.length}개
          </p>
          <p className="text-center text-[11px] text-gray-500">
            토요일부터 금요일까지를 한 주로 봐요
          </p>
        </div>
      </div>
    </div>
  );
}
