"use client";

import { useState, useEffect, useCallback } from "react";
import { AdminDataTable, type AdminDataTableColumn } from "@/components/admin/shell/AdminDataTable";
import { AdminFilterBar } from "@/components/admin/shell/AdminFilterBar";
import { AdminStatusBadge } from "@/components/admin/shell/AdminStatusBadge";

const CARE_PLAN_LABELS: Record<number, string> = { 1: "케어 스타트", 2: "케어 인사이트", 3: "케어 프리미엄" };
const STATUS_LABELS: Record<string, string> = { pending: "승인 대기", approved: "승인", rejected: "거절", cancelled: "취소" };

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR");
}



interface PlanChangeRequestRow {
  id: string;
  current_plan_snapshot: number;
  requested_tier: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requested_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  approved_plan_applied_at: string | null;
  parents: { id: string; name: string | null; email: string | null } | null;
  child_profiles: { id: string; name: string | null } | null;
}

type StatusFilter = "all" | "pending" | "approved" | "rejected" | "cancelled";

export default function PlanChangeRequestsTab() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<PlanChangeRequestRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const qs = statusFilter === "all" ? "" : `?status=${statusFilter}`;
    fetch(`/api/admin/plan-change-requests${qs}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = (rows ?? []).filter((row) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      (row.parents?.name ?? "").toLowerCase().includes(q) ||
      (row.parents?.email ?? "").toLowerCase().includes(q) ||
      (row.child_profiles?.name ?? "").toLowerCase().includes(q)
    );
  });

  const handleApprove = async (row: PlanChangeRequestRow) => {
    const confirmed = window.confirm(
      `요금제 변경을 승인할까요?\n\n자녀: ${row.child_profiles?.name ?? "미상"}\n현재 요금제: ${CARE_PLAN_LABELS[row.current_plan_snapshot]}\n변경 요금제: ${CARE_PLAN_LABELS[row.requested_tier]}`
    );
    if (!confirmed) return;

    setActionLoading(row.id);
    try {
      const res = await fetch(`/api/admin/plan-change-requests/${row.id}/approve`, { method: "POST" });
      if (res.ok) {
        alert("승인되었습니다.");
        load();
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "승인 처리에 실패했습니다.");
        if (res.status === 409) load();
      }
    } catch {
      alert("오류가 발생했습니다.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (row: PlanChangeRequestRow) => {
    const reason = window.prompt("거절 사유를 입력하세요 (선택):");
    if (reason === null) return;
    if (!window.confirm("요금제 변경 요청을 거절할까요?")) return;

    setActionLoading(row.id);
    try {
      const res = await fetch(`/api/admin/plan-change-requests/${row.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        alert("거절 처리되었습니다.");
        load();
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "거절 처리에 실패했습니다.");
      }
    } catch {
      alert("오류가 발생했습니다.");
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: "var(--admin-text-lg)", fontWeight: "var(--admin-weight-bold)", color: "var(--admin-text-primary)", marginBottom: "var(--admin-space-12)" }}>
        요금제 변경 요청
      </h2>

      <AdminFilterBar
        searchNode={
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="부모 이름·이메일·자녀 이름 검색"
            style={{
              width: "100%",
              padding: "var(--admin-space-8) var(--admin-space-12)",
              fontSize: "var(--admin-text-sm)",
              borderRadius: 8,
              border: "1px solid var(--admin-border)",
            }}
          />
        }
        filterNodes={(["all", "pending", "approved", "rejected", "cancelled"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              padding: "var(--admin-space-6) var(--admin-space-12)",
              borderRadius: 8,
              fontSize: "var(--admin-text-sm)",
              fontWeight: statusFilter === s ? "var(--admin-weight-bold)" : "normal",
              border: statusFilter === s ? "1px solid var(--admin-focus)" : "1px solid var(--admin-border)",
              background: statusFilter === s ? "var(--admin-focus)" : "var(--admin-surface)",
              color: statusFilter === s ? "var(--admin-bg)" : "var(--admin-text-secondary)",
              cursor: "pointer",
            }}
          >
            {s === "all" ? "전체" : STATUS_LABELS[s]}
          </button>
        ))}
      />

      <div style={{ marginTop: "var(--admin-space-16)" }}>
        <AdminDataTable
          columns={[
            { key: "requested_at", header: "요청 일시", render: (row) => formatDateTime(row.requested_at) },
            { key: "parents", header: "부모", render: (row) => (
              <>
                {row.parents?.name ?? "미상"}
                <br />
                <span style={{ fontSize: "var(--admin-text-xs)", color: "var(--admin-text-secondary)" }}>{row.parents?.email ?? ""}</span>
              </>
            ) },
            { key: "child", header: "자녀", render: (row) => row.child_profiles?.name ?? "미상" },
            { key: "current_plan", header: "현재 요금제", render: (row) => CARE_PLAN_LABELS[row.current_plan_snapshot] ?? row.current_plan_snapshot },
            { key: "requested_plan", header: "요청 요금제", render: (row) => CARE_PLAN_LABELS[row.requested_tier] ?? row.requested_tier },
            { key: "status", header: "상태", render: (row) => (
              <>
                <AdminStatusBadge
                  text={STATUS_LABELS[row.status]}
                  variant={
                    row.status === "pending" ? "warning" :
                    row.status === "approved" ? "success" :
                    row.status === "rejected" ? "danger" :
                    "neutral"
                  }
                />
                {row.status === "rejected" && row.review_note && (
                  <div style={{ fontSize: "var(--admin-text-xs)", color: "var(--admin-text-secondary)", marginTop: 4 }}>{row.review_note}</div>
                )}
              </>
            ) },
            { key: "reviewed_at", header: "처리 일시", render: (row) => formatDateTime(row.reviewed_at) },
            { key: "action", header: "액션", render: (row) => row.status === "pending" ? (
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => handleReject(row)}
                  disabled={actionLoading === row.id}
                  style={{
                    padding: "var(--admin-space-6) var(--admin-space-12)", borderRadius: 8, border: "1px solid var(--color-k-danger)",
                    background: "white", color: "var(--color-k-danger)", fontSize: "var(--admin-text-xs)", fontWeight: "var(--admin-weight-bold)", cursor: "pointer",
                  }}
                >
                  거절
                </button>
                <button
                  onClick={() => handleApprove(row)}
                  disabled={actionLoading === row.id}
                  style={{
                    padding: "var(--admin-space-6) var(--admin-space-12)", borderRadius: 8, border: "none",
                    background: "var(--admin-focus)", color: "white", fontSize: "var(--admin-text-xs)", fontWeight: "var(--admin-weight-bold)", cursor: "pointer",
                  }}
                >
                  승인
                </button>
              </div>
            ) : <span style={{ fontSize: "var(--admin-text-xs)", color: "var(--admin-text-secondary)" }}>-</span> }
          ]}
          data={filtered}
          isLoading={loading}
          keyExtractor={(row) => row.id}
          emptyMessage="표시할 요청이 없습니다."
        />
      </div>
    </div>
  );
}
