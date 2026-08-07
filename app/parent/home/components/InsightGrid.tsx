import React from "react";
import type { DashboardCardField, DashboardCardInsight } from "@/lib/reports/dashboardCardInsights";

// Format date relative to local timezone
function formatRelativeDate(dateString: string | undefined | null): string {
  if (!dateString) return "기록 없음";
  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "기록 없음";
  const [, yearText, monthText, dayText] = match;
  const [year, month, day] = [yearText, monthText, dayText].map(Number);
  if (!year || !month || !day) return "기록 없음";
  const date = new Date(year, month - 1, day);
  const now = new Date();
  
  // Normalize to start of day
  date.setHours(0, 0, 0, 0);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  const diffMs = today.getTime() - date.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays <= 0) return "오늘";
  if (diffDays === 1) return "1일 전";
  if (diffDays < 7) return `${diffDays}일 전`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}주 전`;
  return "오래전";
}

type InsightMap = Partial<Record<DashboardCardField, DashboardCardInsight>>;

export function InsightGrid({ insights, view }: { insights?: InsightMap | null, view?: "tablet" | "mobile" }) {
  const getStatus = (val?: string, emotionLevel?: string | null, isEmotion?: boolean) => {
    if (!val || val.trim() === "") {
      return { label: "데이터 부족", color: "#9ca3af", dot: "#e5e7eb" };
    }
    if (isEmotion) {
      if (emotionLevel === "safe") return { label: "좋아요", color: "#4298D3", dot: "#4298D3" };
      if (emotionLevel === "warning" || emotionLevel === "danger") return { label: "살펴보기", color: "#E25B12", dot: "#E25B12" };
      return { label: "특징", color: "#10315B", dot: "#10315B" };
    }
    return { label: "특징", color: "#10315B", dot: "#10315B" };
  };

  const getInsightData = (field: DashboardCardField): DashboardCardInsight => {
    return insights?.[field] || { value: null, last_observed_at: null, recent_count: 0 };
  };

  const cards: Array<{
    id: string;
    field: DashboardCardField;
    title: string;
    icon: string;
    isEmotion?: boolean;
  }> = [
    { id: 'school', field: 'school_academy_life', title: '학교·학원 생활', icon: '🏫' },
    { id: 'friend', field: 'peer_friendship', title: '친구 관계', icon: '👥' },
    { id: 'emotion', field: 'emotion_hint', title: '마음 흐름', icon: '💛', isEmotion: true },
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
        
        const status = getStatus(hasData ? data.value! : undefined, data.emotion_level, c.isEmotion);
        const dateStr = formatRelativeDate(data.last_observed_at);
        const countStr = data.recent_count > 0 ? `관찰 ${data.recent_count}일 · ` : "";
        const displayText = hasData ? data.value : "대화 정보 부족";

        return (
          <div 
            key={c.id} 
            className="relative bg-white rounded-[18px] p-4 shadow-sm flex flex-col justify-between min-h-[100px] min-w-0"
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
            <div className="flex items-end justify-between mt-4">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.dot }}></span>
                <span className="text-[10px] font-bold shrink-0" style={{ color: status.color }}>{status.label}</span>
              </div>
              <div className="text-[10px] font-medium text-gray-400 text-right truncate pl-1">
                {hasData ? `${countStr}${dateStr}` : "기록 없음"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
