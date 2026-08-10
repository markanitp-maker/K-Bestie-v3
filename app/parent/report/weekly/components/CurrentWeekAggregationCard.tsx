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
    <section className="mb-6 rounded-[24px] border border-[var(--color-k-sky-blue)]/30 bg-[var(--color-k-info-bg)] p-5 shadow-sm sm:p-6" aria-label="이번 주 대화 집계">
      <div className="mb-5 flex items-start justify-between gap-3">
        <h2 className="text-xl font-extrabold leading-7 text-[var(--color-k-navy)]">
          {formatWeekRange(data.week_start, data.week_end)}
        </h2>
        <span className="shrink-0 rounded-full px-3 py-1.5 text-[13px] font-extrabold text-white" style={{ background: "var(--color-k-navy)" }}>
          이번 주
        </span>
      </div>
      
      <div className="flex items-end justify-between gap-4">
        <p className="pb-1 text-xl font-extrabold text-[var(--color-k-navy)]">이번 주 대화</p>
        <p className="text-[52px] font-extrabold leading-none tracking-[-0.04em] text-[var(--color-k-navy)]">{data.currentConversationCount}<span className="ml-1 text-2xl tracking-normal">회</span></p>
      </div>
      <p className="mt-5 text-sm font-bold text-[var(--color-k-text-secondary)]">집계 {data.currentDayIndex}일째</p>
      
      {data.currentConversationCount === 0 ? (
        <p className="mt-2 text-base leading-7 text-gray-600">아직 이번 주 대화가 없어요</p>
      ) : (
        <p className="mt-2 text-base leading-7 text-gray-600">
          {data.expectedCompletionLabel}
        </p>
      )}
    </section>
  );
}
