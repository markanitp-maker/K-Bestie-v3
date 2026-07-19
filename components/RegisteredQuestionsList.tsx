"use client";

import { useEffect, useState } from "react";

export interface Question {
  id: string;
  question_text: string;
  status: string;
  created_at: string;
  delivered_count: number;
  child_answer_summary?: string;
}

const STATUS_MAP: Record<string, { label: string; bg: string; color: string }> = {
  draft: { label: "확인 중 · 최대 48시간 소요", bg: "#F3F4F6", color: "#6B7280" },
  ai_generated: { label: "확인 중 · 최대 48시간 소요", bg: "#F3F4F6", color: "#6B7280" },
  parent_edited: { label: "확인 중 · 최대 48시간 소요", bg: "#F3F4F6", color: "#6B7280" },
  mission_confirming: { label: "확인 중 · 최대 48시간 소요", bg: "#F3F4F6", color: "#6B7280" },
  confirmed: { label: "확인 완료", bg: "#DCFCE7", color: "#15803D" },
  declined: { label: "명확한 답변 거부", bg: "#FEF2F2", color: "#DC2626" },
  mission_incomplete: { label: "미션 미완료", bg: "#FEF2F2", color: "#DC2626" },
  failed_system: { label: "일시적인 문제로 확인을 완료하지 못했습니다. 질문 기회는 복구되었습니다", bg: "#FEF2F2", color: "#DC2626" },
  failed_recovered: { label: "일시적인 문제로 확인을 완료하지 못했습니다. 질문 기회는 복구되었습니다", bg: "#FEF2F2", color: "#DC2626" },
};

export function RegisteredQuestionsList({ questions }: { questions: Question[] }) {
  const [prevStatuses, setPrevStatuses] = useState<Record<string, string>>({});

  useEffect(() => {
    // 마지막 확인 시각(또는 상태) 불러오기
    const saved = localStorage.getItem("k_question_statuses");
    if (saved) {
      try {
        setPrevStatuses(JSON.parse(saved));
      } catch (e) {}
    }
    
    // 컴포넌트가 마운트/업데이트될 때 현재 상태를 localStorage에 저장하여 다음 번 비교에 사용
    // (사용자가 이 화면을 '본' 것으로 간주)
    if (questions.length > 0) {
      const currentStatuses: Record<string, string> = {};
      questions.forEach((q) => {
        currentStatuses[q.id] = q.status;
      });
      localStorage.setItem("k_question_statuses", JSON.stringify(currentStatuses));
      // 네비게이션에서 NEW 배지 숨기기 위한 이벤트 발생
      window.dispatchEvent(new Event("questions_viewed"));
    }
  }, [questions]);

  if (!questions || questions.length === 0) {
    return <p className="text-sm text-gray-500 text-center py-4">등록된 질문이 없습니다.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {questions.map((q) => {
        const style = STATUS_MAP[q.status] || STATUS_MAP.draft;
        const isNew = prevStatuses[q.id] && prevStatuses[q.id] !== q.status;
        const isNewlyCreated = !prevStatuses[q.id] && Object.keys(prevStatuses).length > 0;
        const showNewBadge = isNew || isNewlyCreated;

        return (
          <div key={q.id} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm relative">
            {showNewBadge && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full z-10 shadow-sm animate-pulse">
                NEW
              </span>
            )}
            <div className="flex justify-between items-start mb-2">
              <span
                className="px-2.5 py-0.5 rounded-full text-[10px] font-bold inline-block"
                style={{ background: style.bg, color: style.color }}
              >
                {style.label}
              </span>
            </div>
            
            <p className="text-sm font-semibold text-gray-800 leading-snug break-keep">
              <span className="mr-1.5 opacity-80">Q.</span>
              {q.question_text}
            </p>
            
            {q.status === "confirmed" && q.child_answer_summary && (
              <div className="mt-3 bg-gray-50 rounded-lg p-3">
                <p className="text-xs font-bold text-gray-600 mb-1">케이의 확인 결과</p>
                <p className="text-sm text-gray-800 break-keep">{q.child_answer_summary}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
