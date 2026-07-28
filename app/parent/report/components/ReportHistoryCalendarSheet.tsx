"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

interface CalendarMetadata {
  report_id: string;
  child_id: string;
  report_date: string;
  created_at: string;
  mood_score: number;
  emotion_level: string;
}

interface ReportHistoryCalendarSheetProps {
  childId: string;
  isOpen: boolean;
  onClose: () => void;
  initialMonthStr?: string; // "YYYY-MM"
}

export function ReportHistoryCalendarSheet({
  childId,
  isOpen,
  onClose,
  initialMonthStr,
}: ReportHistoryCalendarSheetProps) {
  const router = useRouter();

  // 현재 KST 기준 월 계산
  const getKstNow = () => {
    const d = new Date();
    d.setUTCHours(d.getUTCHours() + 9);
    return d;
  };

  const kstNow = getKstNow();
  const currentY = kstNow.getUTCFullYear();
  const currentM = kstNow.getUTCMonth() + 1;
  const currentYm = `${currentY}-${String(currentM).padStart(2, "0")}`;

  const [viewMonth, setViewMonth] = useState<string>(initialMonthStr || currentYm);
  const [metadata, setMetadata] = useState<CalendarMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oldestAllowedMonth, setOldestAllowedMonth] = useState<string>("2000-01");

  const sheetRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const triggerBtnRef = useRef<HTMLElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (!triggerBtnRef.current) {
        triggerBtnRef.current = document.activeElement as HTMLElement;
      }
      document.body.style.overflow = "hidden";
      closeBtnRef.current?.focus();
    } else {
      document.body.style.overflow = "";
      if (triggerBtnRef.current) {
        triggerBtnRef.current.focus();
        triggerBtnRef.current = null;
      }
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !sheetRef.current) return;
    const sheet = sheetRef.current;
    
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = sheet.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      
      if (!sheet.contains(document.activeElement)) {
        first.focus();
        e.preventDefault();
        return;
      }
      
      if (e.shiftKey) {
        if (document.activeElement === first) {
          last.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };
    
    sheet.addEventListener("keydown", handleTab);
    return () => sheet.removeEventListener("keydown", handleTab);
  }, [isOpen]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  const fetchMonth = useCallback(
    async (monthStr: string) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/parent/report-history?childId=${childId}&month=${monthStr}`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error("조회 오류");
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setMetadata(data.reports || []);
        if (data.oldestAllowedMonth) {
          setOldestAllowedMonth(data.oldestAllowedMonth);
        }
      } catch (err: any) {
        if (err.name === "AbortError") return;
        setError("지난 이력 날짜를 불러오지 못했어요.");
      } finally {
        // loading state should only be updated if not aborted
        // but simple enough to just set it unless unmounted
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [childId]
  );

  useEffect(() => {
    if (isOpen && childId) {
      fetchMonth(viewMonth);
    }
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [isOpen, childId, viewMonth, fetchMonth]);

  if (!isOpen) return null;

  const [yStr, mStr] = viewMonth.split("-");
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);

  const prevMonth = () => {
    const prevD = new Date(year, month - 2, 1);
    const prevYm = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, "0")}`;
    if (prevYm < oldestAllowedMonth) return;
    setViewMonth(prevYm);
  };

  const nextMonth = () => {
    const nextD = new Date(year, month, 1);
    const targetYm = `${nextD.getFullYear()}-${String(nextD.getMonth() + 1).padStart(2, "0")}`;
    if (targetYm > currentYm) return;
    setViewMonth(targetYm);
  };

  const isNextDisabled = viewMonth >= currentYm;
  const isPrevDisabled = (() => {
    const prevD = new Date(year, month - 2, 1);
    const prevYm = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, "0")}`;
    return prevYm < oldestAllowedMonth;
  })();

  // Calendar logic
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0(Sun) ~ 6(Sat)

  // 월요일부터 시작하도록 조정 (월=0, 화=1 ... 일=6)
  const firstDayAdjusted = firstDay === 0 ? 6 : firstDay - 1;

  const gridCells = [];
  for (let i = 0; i < firstDayAdjusted; i++) {
    gridCells.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    gridCells.push(d);
  }
  const remaining = gridCells.length % 7;
  if (remaining !== 0) {
    for (let i = 0; i < 7 - remaining; i++) {
      gridCells.push(null);
    }
  }

  const handleDateClick = (report: CalendarMetadata) => {
    onClose();
    router.push(`/parent/report/${report.report_id}`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="과거 이력 달력"
    >
      <div
        className="absolute inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
      />

      <div
        ref={sheetRef}
        className="relative bg-white w-full rounded-t-3xl pt-6 pb-10 px-5 flex flex-col shadow-2xl animate-slide-up max-w-[520px] mx-auto h-[60dvh]"
        role="document"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={prevMonth}
            disabled={isPrevDisabled}
            className={`w-10 h-10 flex items-center justify-center rounded-full ${
              isPrevDisabled ? "text-gray-300 cursor-not-allowed" : "active:bg-gray-100"
            }`}
            aria-label="이전 달"
          >
            &lt;
          </button>
          <h2 className="text-lg font-bold" style={{ color: "var(--color-k-navy, #10315B)" }}>
            {year}년 {month}월
          </h2>
          <div className="flex items-center gap-1">
            <button
              onClick={nextMonth}
              disabled={isNextDisabled}
              className={`w-10 h-10 flex items-center justify-center rounded-full ${
                isNextDisabled ? "text-gray-300" : "active:bg-gray-100"
              }`}
              aria-label="다음 달"
            >
              &gt;
            </button>
            <button
              ref={closeBtnRef}
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-50 active:bg-gray-200 ml-2"
              aria-label="달력 닫기"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 요일 */}
        <div className="grid grid-cols-7 mb-2 text-center text-xs font-bold text-gray-500">
          <div>월</div>
          <div>화</div>
          <div>수</div>
          <div>목</div>
          <div>금</div>
          <div>토</div>
          <div>일</div>
        </div>

        {/* 날짜 그리드 */}
        <div className="flex-1 overflow-y-auto min-h-0 relative">
          {error ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <p className="text-sm font-bold text-red-500">{error}</p>
              <button
                onClick={() => fetchMonth(viewMonth)}
                className="px-4 py-2 bg-gray-100 rounded-full text-xs font-bold"
              >
                다시 시도
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-y-2">
              {gridCells.map((day, idx) => {
                if (!day) return <div key={idx} className="h-12" />;

                const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const report = metadata.find((r) => r.report_date === dateStr);
                const isFuture = dateStr > getKstNow().toISOString().split("T")[0];
                const isToday = dateStr === getKstNow().toISOString().split("T")[0];

                let ariaLabel = `${year}년 ${month}월 ${day}일`;
                if (isToday) ariaLabel += ", 오늘";
                if (report && !isFuture) ariaLabel += ", 일간 리포트 있음";
                else if (!isFuture) ariaLabel += ", 리포트 없음";

                const isClickable = report && !isFuture;

                return (
                  <div key={idx} className="h-12 flex flex-col items-center justify-center">
                    <button
                      disabled={!isClickable}
                      onClick={() => isClickable && handleDateClick(report)}
                      className={`relative w-8 h-8 flex items-center justify-center rounded-full text-sm font-semibold transition-colors
                        ${isFuture ? "text-gray-300" : "text-gray-700"}
                        ${isToday && !report ? "border border-gray-400" : ""}
                        ${isClickable ? "active:ring-2 active:ring-orange-500 hover:bg-gray-50" : ""}
                      `}
                      aria-label={ariaLabel}
                      aria-disabled={!isClickable}
                    >
                      {day}
                    </button>
                    <div className="h-2 mt-0.5">
                      {report && (
                        <div
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: "var(--color-k-skyblue, #4298D3)" }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 로딩 표시 */}
          {loading && (
            <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
            </div>
          )}

          {/* 빈 상태 */}
          {!loading && !error && metadata.length === 0 && (
            <div className="mt-8 text-center px-4">
              <p className="text-xs font-semibold text-gray-400 leading-relaxed">
                이 달에는 생성된 일간 리포트가 없어요.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
