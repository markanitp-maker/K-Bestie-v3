import React from "react";
import type { DashboardCardField, DashboardCardInsight } from "@/lib/reports/dashboardCardInsights";

type InsightMap = Partial<Record<DashboardCardField, DashboardCardInsight>>;

export function InsightGrid({ insights, view }: { insights?: InsightMap | null, view?: "tablet" | "mobile" }) {
  const getInsightData = (field: DashboardCardField): DashboardCardInsight => {
    return insights?.[field] || { value: null, last_observed_at: null, recent_count: 0 };
  };

  const cards: Array<{
    id: string;
    field: DashboardCardField;
    title: string;
    icon: string;
  }> = [
    { id: 'school', field: 'school_academy_life', title: '학교·학원 생활', icon: '🏫' },
    { id: 'friend', field: 'peer_friendship', title: '친구 관계', icon: '👥' },
    { id: 'emotion', field: 'emotion_hint', title: '마음 흐름', icon: '💛' },
    { id: 'interest', field: 'interests_preferences', title: '관심사·취향', icon: '✨' },
    { id: 'study', field: 'study_concerns', title: '공부 고민', icon: '📚' },
    { id: 'digital', field: 'digital_content_interests', title: '디지털·콘텐츠', icon: '📱' },
    { id: 'teacher', field: 'teacher_adults', title: '선생님·어른', icon: '👩‍🏫' },
    { id: 'repeat', field: 'recurring_stories', title: '반복 이야기', icon: '🔁' },
  ];

  return (
    <div className={`grid ${view === "tablet" ? "grid-cols-4" : "grid-cols-2"} mb-2.5 gap-x-3 gap-y-2.5 sm:gap-4`}>
      {cards.map(c => {
        const data = getInsightData(c.field);
        const hasData = typeof data.value === "string" && data.value.trim() !== "";
        
        const displayText = hasData ? data.value : "대화 정보 부족";

        return (
          <div 
            key={c.id} 
            className="relative min-w-0 min-h-[76px] rounded-[18px] border border-[#10315B]/20 bg-white px-4 py-2.5 shadow-sm sm:min-h-[156px] sm:p-5"
          >
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-[26px] leading-none sm:text-[30px]" aria-hidden="true">{c.icon}</span>
                <span className="break-keep text-[16px] font-bold leading-snug text-[#1F2937] sm:text-[17px]">{c.title}</span>
              </div>
              <p className="text-[13px] font-semibold leading-[1.45] text-gray-700 sm:text-sm">
                {displayText}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
