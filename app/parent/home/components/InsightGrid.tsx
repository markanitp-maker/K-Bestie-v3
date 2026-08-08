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
    <div className={`grid ${view === "tablet" ? "grid-cols-4" : "grid-cols-2"} gap-3 mb-8`}>
      {cards.map(c => {
        const data = getInsightData(c.field);
        const hasData = typeof data.value === "string" && data.value.trim() !== "";
        
        const displayText = hasData ? data.value : "대화 정보 부족";

        return (
          <div 
            key={c.id} 
            className="relative bg-white rounded-[18px] p-4 shadow-sm min-h-[100px] min-w-0"
          >
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-base" aria-hidden="true">{c.icon}</span>
                <span className="text-[11px] font-bold text-gray-500 break-keep">{c.title}</span>
              </div>
              <p className="text-[clamp(9px,2.4vw,13px)] font-bold text-gray-800 leading-snug whitespace-nowrap tracking-tight">
                {displayText}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
