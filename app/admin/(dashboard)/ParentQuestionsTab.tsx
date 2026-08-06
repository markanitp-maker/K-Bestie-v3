"use client";

import React, { useState, useEffect, useCallback } from "react";
import { AdminResponsiveTable } from "@/components/admin/shell/AdminResponsiveTable";
import { AdminFilterBar } from "@/components/admin/shell/AdminFilterBar";
import { AdminStatusBadge } from "@/components/admin/shell/AdminStatusBadge";

interface ParentQuestionRow {
  id: string;
  child_id: string;
  question_text: string;
  status: string;
  created_at: string;
  deadline_at: string | null;
  delivered_count: number;
  mission_confirm_attempts: number;
  retry_count: number;
  confirmed_at: string | null;
  declined_at: string | null;
  cancelled_at: string | null;
  expired_at: string | null;
  child_answer_summary: string | null;
  failure_code: string | null;
  child_profiles: { name: string; family_id: string } | null;
}

const STATUS_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "ai_generated", label: "대기 중" },
  { value: "mission_confirming", label: "질문 전달됨" },
  { value: "reconfirm_pending", label: "재확인 중" },
  { value: "confirmed", label: "답변 완료" },
  { value: "declined", label: "답변 거부" },
  { value: "cancelled", label: "취소됨" },
  { value: "expired", label: "만료됨" },
  { value: "failed_system", label: "시스템 오류" },
  { value: "failed_recovered", label: "재시도 소진" },
];

function badgeVariant(status: string): "success" | "danger" | "neutral" | "warning" {
  if (status === "confirmed") return "success";
  if (["declined", "cancelled", "expired", "failed_system", "failed_recovered"].includes(status)) return "danger";
  if (status === "reconfirm_pending" || status === "mission_confirming") return "warning";
  return "neutral";
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR");
}

export default function ParentQuestionsTab() {
  const [questions, setQuestions] = useState<ParentQuestionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("all");

  const load = useCallback(() => {
    setLoading(true);
    const query = new URLSearchParams();
    if (status !== "all") query.set("status", status);
    fetch(`/api/admin/parent-questions?${query.toString()}`)
      .then((r) => r.json())
      .then((d) => setQuestions(d.questions || []))
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <AdminFilterBar
        filterNodes={[
          <select
            key="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{ height: 40, padding: "0 12px", borderRadius: 8, border: "1px solid var(--admin-border)", fontSize: "var(--admin-text-body)" }}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>,
        ]}
        mobileFilterSheetNodes={[
          <select
            key="status-mobile"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{ width: "100%", height: 44, padding: "0 12px", borderRadius: 8, border: "1px solid var(--admin-border)", fontSize: "var(--admin-text-body)" }}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>,
        ]}
      />

      <AdminResponsiveTable
        mobileStrategy="card"
        isLoading={loading}
        data={questions}
        keyExtractor={(q: ParentQuestionRow) => q.id}
        emptyMessage="표시할 항목이 없습니다."
        columns={[
          {
            key: "question",
            header: "질문 / 아이",
            render: (q: ParentQuestionRow) => (
              <div>
                <div style={{ fontWeight: 600 }}>{q.question_text}</div>
                <div style={{ fontSize: 12, color: "var(--admin-text-secondary)", marginTop: 2 }}>
                  {q.child_profiles?.name ?? q.child_id}
                </div>
              </div>
            ),
          },
          {
            key: "status",
            header: "상태",
            render: (q: ParentQuestionRow) => (
              <div>
                <AdminStatusBadge text={STATUS_OPTIONS.find((o) => o.value === q.status)?.label ?? q.status} variant={badgeVariant(q.status)} />
                <div style={{ fontSize: 11, color: "var(--admin-text-secondary)", marginTop: 4 }}>
                  전달 {q.delivered_count}회 · 재확인 {q.mission_confirm_attempts}/2 · 재시도 {q.retry_count}/3
                </div>
              </div>
            ),
          },
          {
            key: "answer",
            header: "답변",
            render: (q: ParentQuestionRow) => (
              <div style={{ fontSize: 13, maxWidth: 220 }}>
                {q.child_answer_summary || "-"}
              </div>
            ),
          },
          {
            key: "timeline",
            header: "일정",
            render: (q: ParentQuestionRow) => (
              <div style={{ fontSize: 11, color: "var(--admin-text-secondary)", lineHeight: 1.6 }}>
                <div>등록 {formatDateTime(q.created_at)}</div>
                <div>기한 {formatDateTime(q.deadline_at)}</div>
                {q.confirmed_at && <div>확인 {formatDateTime(q.confirmed_at)}</div>}
                {q.declined_at && <div>거부 {formatDateTime(q.declined_at)}</div>}
                {q.cancelled_at && <div>취소 {formatDateTime(q.cancelled_at)}</div>}
                {q.expired_at && <div>만료 {formatDateTime(q.expired_at)}</div>}
              </div>
            ),
          },
          {
            key: "error",
            header: "오류",
            render: (q: ParentQuestionRow) => (
              <div style={{ fontSize: 12, color: q.failure_code ? "var(--admin-danger)" : "var(--admin-text-secondary)" }}>
                {q.failure_code || "-"}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
