"use client";

import { useState, useEffect, useCallback } from "react";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { ParentHeader } from "@/components/ParentHeader";
import { RealParentNav } from "@/components/RealParentNav";
import { useStore } from "@/hooks/useStore";

interface ParentQuestion {
  id: string;
  question_text: string;
  status: string;
  created_at: string;
  delivered_count: number;
  child_answer_summary: string | null;
  confirmed_at: string | null;
  declined_at: string | null;
  cancelled_at: string | null;
  expired_at: string | null;
}

// requests/request-parent-question-feature.md §8 상태별 부모 표시 문구
const STATUS_LABEL: Record<string, string> = {
  draft: "질문 준비 중",
  ai_generated: "질문 대기 중",
  parent_edited: "질문 대기 중",
  mission_confirming: "아이에게 질문했어요",
  reconfirm_pending: "아이에게 답변을 다시 확인하고 있어요",
  confirmed: "답변 완료",
  declined: "아이가 답변하지 않기로 했어요",
  cancelled: "질문이 취소됐어요",
  expired: "기간 내 질문하지 못했어요",
  mission_incomplete: "질문 대기 중",
  failed_system: "처리 중 문제가 발생했어요",
  failed_recovered: "처리 중 문제가 발생했어요",
  중지됨: "질문이 취소됐어요",
  대기중: "질문 대기 중",
  전달됨: "아이에게 질문했어요",
};

type FilterKey = "all" | "pending" | "answered" | "declined";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "pending", label: "대기 중" },
  { key: "answered", label: "답변 완료" },
  { key: "declined", label: "답변하지 않음" },
];

const TERMINAL_STATUSES = new Set(["confirmed", "declined", "cancelled", "expired", "중지됨", "failed_system", "failed_recovered"]);

function matchesFilter(status: string, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "answered") return status === "confirmed";
  if (filter === "declined") return status === "declined" || status === "cancelled" || status === "expired" || status === "중지됨";
  // pending: 위 두 범주에 속하지 않는 진행 중 상태 전부
  return !["confirmed", "declined", "cancelled", "expired", "중지됨"].includes(status);
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export default function ParentQuestionsPage() {
  const { activeChildId } = useStore();
  const [questions, setQuestions] = useState<ParentQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");

  const childId = activeChildId ?? (typeof window !== "undefined" ? localStorage.getItem("k_child_id") : null);

  const load = useCallback(async () => {
    if (!childId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/parent/questions?childId=${childId}`);
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      setQuestions(data.questions ?? []);

      // RealParentNav의 새 답변 배지 상태 갱신에 사용하는 로컬 캐시를 함께 업데이트한다.
      const statuses: Record<string, string> = {};
      for (const q of data.questions ?? []) statuses[q.id] = q.status;
      localStorage.setItem("k_question_statuses", JSON.stringify(statuses));
      window.dispatchEvent(new Event("questions_viewed"));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [childId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = questions.filter((q) => matchesFilter(q.status, filter));

  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const handleCancel = async (id: string) => {
    if (!confirm("이 질문 등록을 취소할까요?")) return;
    setCancellingId(id);
    try {
      const res = await fetch(`/api/parent/questions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      if (res.ok) await load();
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <DemoFrame>
      <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
        <ParentHeader />

        <div className="bg-white px-4 py-3 border-b shadow-sm z-10 relative">
          <div className="flex justify-between items-center">
            <h1 className="font-bold text-gray-900">케이와 대화</h1>
          </div>
          <div className="flex gap-1 mt-2.5">
            <a
              href="/parent/guide"
              className="flex-1 text-center text-xs font-bold py-1.5 rounded-full bg-gray-100 text-gray-600"
            >
              대화
            </a>
            <div className="flex-1 text-center text-xs font-bold py-1.5 rounded-full bg-[var(--color-k-navy)] text-white">
              Q&amp;A
            </div>
          </div>
        </div>

        <div className="px-4 py-3 flex gap-1.5 overflow-x-auto bg-white border-b">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full border whitespace-nowrap ${
                filter === f.key
                  ? "bg-[var(--color-k-navy)] text-white border-transparent"
                  : "bg-white text-gray-600 border-gray-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {!childId ? (
            <div className="text-center text-sm text-gray-500 mt-10">자녀를 먼저 선택해주세요.</div>
          ) : loading ? (
            <div className="text-center text-sm text-gray-400 mt-10">불러오는 중...</div>
          ) : error ? (
            <div className="text-center text-sm text-red-500 mt-10">
              목록을 불러오지 못했어요.
              <button onClick={() => void load()} className="ml-2 underline">
                다시 시도
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-sm text-gray-400 mt-10">표시할 항목이 없습니다.</div>
          ) : (
            filtered.map((q) => (
              <div key={q.id} className="bg-white rounded-2xl px-4 py-4 shadow-sm border border-gray-100">
                <p className="text-sm font-semibold text-gray-900 leading-relaxed">{q.question_text}</p>
                <p className="text-[11px] text-gray-400 mt-1">등록 {formatDate(q.created_at)}</p>
                <div className="mt-2.5 pt-2.5 border-t border-gray-50">
                  <p className="text-xs font-bold" style={{ color: "var(--color-k-navy)" }}>
                    {STATUS_LABEL[q.status] ?? q.status}
                  </p>
                  {q.status === "confirmed" && q.child_answer_summary && (
                    <>
                      <p className="text-sm text-gray-700 mt-1.5 leading-relaxed">{q.child_answer_summary}</p>
                      {q.confirmed_at && (
                        <p className="text-[11px] text-gray-400 mt-1">확인 {formatDate(q.confirmed_at)}</p>
                      )}
                    </>
                  )}
                  {q.status === "declined" && (
                    <p className="text-xs text-gray-500 mt-1.5">아이가 이번 질문에는 답변하지 않기로 했어요.</p>
                  )}
                  {!TERMINAL_STATUSES.has(q.status) && (
                    <button
                      onClick={() => handleCancel(q.id)}
                      disabled={cancellingId === q.id}
                      className="mt-2 text-xs font-semibold text-gray-400 underline disabled:opacity-50"
                    >
                      {cancellingId === q.id ? "취소하는 중..." : "질문 취소하기"}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <RealParentNav active="케이와 대화" />
      </div>
    </DemoFrame>
  );
}
