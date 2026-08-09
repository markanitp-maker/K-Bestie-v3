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
    <section className="bg-[var(--color-k-info-bg)] border border-[var(--color-k-sky-blue)]/30 rounded-[20px] p-5 mb-5 border-dashed shadow-sm" aria-label="이번 주 대화 집계">
      <div className="flex justify-between items-start mb-4">
        <h2 className="text-lg font-bold text-[var(--color-k-navy)]">
          {formatWeekRange(data.week_start, data.week_end)}
        </h2>
        <span className="text-xs font-bold px-2.5 py-1 rounded-full text-white" style={{ background: "var(--color-k-navy)" }}>
          이번 주
        </span>
      </div>
      
      <p className="text-lg font-bold text-[var(--color-k-navy)]">이번 주 대화</p>
      <p className="mt-1 text-4xl font-bold leading-none text-[var(--color-k-navy)]">{data.currentConversationCount}<span className="ml-1 text-xl">회</span></p>
      <div className="mt-4 flex items-center gap-1.5 text-sm font-bold text-[var(--color-k-navy)]">
        <span aria-hidden="true">⏳</span>
        <span>집계 중 · {data.currentDayIndex}일째</span>
      </div>
      
      {data.currentConversationCount === 0 ? (
        <p className="mt-2 text-base text-gray-600 leading-6">아직 이번 주 대화가 없어요</p>
      ) : (
        <p className="mt-2 text-base text-gray-600">
          {data.expectedCompletionLabel}
        </p>
      )}
    </section>
  );
}
