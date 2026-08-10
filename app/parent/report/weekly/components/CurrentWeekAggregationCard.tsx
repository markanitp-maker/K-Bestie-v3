import React from "react";

interface CurrentAggregation {
  week_start: string;
  week_end: string;
  currentDayIndex: number;
  currentConversationCount: number;
  expectedCompletionLabel: string;
}

export function formatWeekRange(start: string, end: string): string {
  const sDate = new Date(start + "T00:00:00Z");
  const eDate = new Date(end + "T00:00:00Z");
  const sMonth = sDate.getUTCMonth() + 1;
  const sDay = sDate.getUTCDate();
  const eMonth = eDate.getUTCMonth() + 1;
  const eDay = eDate.getUTCDate();
  
  if (sMonth === eMonth) {
    return `${sMonth}월 ${sDay}일~${eDay}일`;
  }
  return `${sMonth}월 ${sDay}일~${eMonth}월 ${eDay}일`;
}

export function CurrentWeekAggregationCard({ data }: { data: CurrentAggregation | null }) {
  if (!data) return null;

  return (
    <section className="mb-6 flex items-center justify-between gap-3 rounded-[24px] border border-[var(--color-k-sky-blue)]/30 bg-[var(--color-k-info-bg)] px-5 py-4 shadow-sm sm:px-6" aria-label="이번 주">
        <h2 className="text-xl font-extrabold leading-7 text-[var(--color-k-navy)]">
          {formatWeekRange(data.week_start, data.week_end)}
        </h2>
        <span className="shrink-0 rounded-full px-3 py-1.5 text-[13px] font-extrabold text-white" style={{ background: "var(--color-k-navy)" }}>
          이번 주
        </span>
    </section>
  );
}
