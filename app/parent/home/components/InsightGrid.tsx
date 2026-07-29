import React from "react";

// Format date relative to local timezone
function formatRelativeDate(dateString: string | undefined | null): string {
  if (!dateString) return "기록 없음";
  const date = new Date(dateString);
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

interface Report {
  id?: string;
  business_date?: string;
  created_at?: string;
}

function getCompactSummary(text: string | null | undefined): string {
  if (!text || text.trim() === "") return "";
  const trimmed = text.trim();
  if (trimmed.length <= 12) return trimmed;
  
  // Try to find a short sentence ending with punctuation or polite endings
  const sentences = trimmed.split(/(?<=[.!?])\s+|(?<=[다요어음지네])\s+/);
  const shortSentences = sentences.filter(s => s.trim().length > 0 && s.trim().length <= 12);
  
  if (shortSentences.length > 0) {
    return shortSentences[0].trim();
  }
  
  // If no short sentence can be extracted cleanly, provide a meaningful fallback <= 12 chars
  return "새로운 이야기가 있어요";
}

export function InsightGrid({ report, insights, view }: { report?: Report | null, insights?: any, view?: "tablet" | "mobile" }) {
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

  const getInsightData = (field: string) => {
    return insights?.[field] || { value: null, last_observed_at: null, recent_count: 0 };
  };

  const cards = [
    { id: 'school', field: 'school_academy_life', title: '학교·학원 생활', icon: '🏫' },
    { id: 'friend', field: 'peer_friendship', title: '친구 관계', icon: '👥' },
    { id: 'emotion', field: 'emotion_hint', title: '마음 흐름', icon: '💛', isEmotion: true },
    { id: 'interest', field: 'interests_preferences', title: '관심사·취향', icon: '✨' },
    { id: 'study', field: 'study_concerns', title: '공부 고민', icon: '📚' },
    { id: 'digital', field: 'digital_content_interests', title: '디지털·콘텐츠', icon: '📱' },
    { id: 'teacher', field: 'teacher', title: '선생님·어른', icon: '👩‍🏫' },
    { id: 'repeat', field: 'recurring_stories', title: '반복 이야기', icon: '🔁' },
  ];

  return (
    <div className={`grid ${view === "tablet" ? "grid-cols-4" : "grid-cols-2"} gap-3 mb-8`}>
      {cards.map(c => {
        const data = getInsightData(c.field);
        const hasData = data.value && data.value.trim() !== "";
        const isUnsupported = c.id === 'teacher';
        
        // Use exactly the text requested for empty state
        const emptyMessage = isUnsupported ? "분석을 준비 중이에요" : "확인된 내용이 없어요";
        
        const status = getStatus(hasData ? data.value : undefined, data.emotion_level, c.isEmotion);
        const dateStr = formatRelativeDate(data.last_observed_at);
        const countStr = data.recent_count > 0 ? `관찰 ${data.recent_count}일 · ` : "";
        
        const displayText = hasData ? getCompactSummary(data.value) : emptyMessage;

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
              <p className="text-[13px] font-bold text-gray-800 leading-snug break-keep">
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
