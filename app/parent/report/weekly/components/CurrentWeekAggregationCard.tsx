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
    <div className="bg-[#f0f9ff] border border-[#bae6fd] rounded-[16px] p-4 mb-3 border-dashed shadow-sm">
      <div className="flex justify-between items-start mb-2">
        <h2 className="text-[14px] font-bold text-[#10315B]">
          {formatWeekRange(data.week_start, data.week_end)}
        </h2>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md text-white" style={{ background: "#10315B" }}>
          이번 주
        </span>
      </div>
      
      <div className="flex items-center gap-1.5 text-[14px] font-bold text-[#10315B] mb-1">
        <span>⏳</span>
        <span>집계 중 · {data.currentDayIndex}일째{data.currentConversationCount > 0 ? ` · 대화 ${data.currentConversationCount}회` : ""}</span>
      </div>
      
      {data.currentConversationCount === 0 ? (
        <p className="text-[13px] text-gray-500 leading-snug">아직 이번 주 대화가 없어요<br/><span className="text-[12px] text-gray-400">아이가 케이와 이야기하면 주간 리포트에 반영돼요</span></p>
      ) : (
        <p className="text-[13px] text-gray-500">
          {data.expectedCompletionLabel}
        </p>
      )}
    </div>
  );
}
