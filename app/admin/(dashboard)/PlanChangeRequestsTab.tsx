"use client";

import { useState, useEffect, useCallback } from "react";

const CARE_PLAN_LABELS: Record<number, string> = { 1: "케어 스타트", 2: "케어 인사이트", 3: "케어 프리미엄" };
const STATUS_LABELS: Record<string, string> = { pending: "승인 대기", approved: "승인", rejected: "거절", cancelled: "취소" };

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR");
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  fontSize: 12,
  color: "var(--color-k-text-secondary)",
  borderBottom: "1px solid var(--color-k-border)",
};
const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 13,
  color: "var(--color-k-text-primary)",
  borderBottom: "1px solid var(--color-k-border)",
  verticalAlign: "top",
};

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
      <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--color-k-text-primary)", marginBottom: 12 }}>
        요금제 변경 요청
      </h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {(["all", "pending", "approved", "rejected", "cancelled"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: statusFilter === s ? 700 : 400,
              border: statusFilter === s ? "1px solid var(--color-k-navy)" : "1px solid var(--color-k-border)",
              background: statusFilter === s ? "var(--color-k-navy-tint)" : "transparent",
              color: statusFilter === s ? "var(--color-k-navy)" : "var(--color-k-text-secondary)",
              cursor: "pointer",
            }}
          >
            {s === "all" ? "전체" : STATUS_LABELS[s]}
          </button>
        ))}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="부모 이름·이메일·자녀 이름 검색"
          style={{
            marginLeft: "auto",
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 8,
            border: "1px solid var(--color-k-border)",
            minWidth: 220,
          }}
        />
      </div>

      {loading && !rows ? (
        <p style={{ fontSize: 13, color: "var(--color-k-text-secondary)" }}>불러오는 중...</p>
      ) : filtered.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--color-k-text-secondary)" }}>표시할 요청이 없습니다.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>요청 일시</th>
                <th style={thStyle}>부모</th>
                <th style={thStyle}>자녀</th>
                <th style={thStyle}>현재 요금제</th>
                <th style={thStyle}>요청 요금제</th>
                <th style={thStyle}>상태</th>
                <th style={thStyle}>처리 일시</th>
                <th style={thStyle}>액션</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td style={tdStyle}>{formatDateTime(row.requested_at)}</td>
                  <td style={tdStyle}>
                    {row.parents?.name ?? "미상"}
                    <br />
                    <span style={{ fontSize: 11, color: "var(--color-k-text-secondary)" }}>{row.parents?.email ?? ""}</span>
                  </td>
                  <td style={tdStyle}>{row.child_profiles?.name ?? "미상"}</td>
                  <td style={tdStyle}>{CARE_PLAN_LABELS[row.current_plan_snapshot] ?? row.current_plan_snapshot}</td>
                  <td style={tdStyle}>{CARE_PLAN_LABELS[row.requested_tier] ?? row.requested_tier}</td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                        background:
                          row.status === "pending" ? "#fff4e5" : row.status === "approved" ? "#e6f4ea" : row.status === "rejected" ? "#fdecea" : "#f1f1f1",
                        color:
                          row.status === "pending" ? "#b45309" : row.status === "approved" ? "#1e7e34" : row.status === "rejected" ? "#c0392b" : "#666",
                      }}
                    >
                      {STATUS_LABELS[row.status]}
                    </span>
                    {row.status === "rejected" && row.review_note && (
                      <div style={{ fontSize: 11, color: "var(--color-k-text-secondary)", marginTop: 4 }}>{row.review_note}</div>
                    )}
                  </td>
                  <td style={tdStyle}>{formatDateTime(row.reviewed_at)}</td>
                  <td style={tdStyle}>
                    {row.status === "pending" ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => handleReject(row)}
                          disabled={actionLoading === row.id}
                          style={{
                            padding: "6px 10px", borderRadius: 8, border: "1px solid var(--color-k-danger)",
                            background: "white", color: "var(--color-k-danger)", fontSize: 11, fontWeight: 700, cursor: "pointer",
                          }}
                        >
                          거절
                        </button>
                        <button
                          onClick={() => handleApprove(row)}
                          disabled={actionLoading === row.id}
                          style={{
                            padding: "6px 10px", borderRadius: 8, border: "none",
                            background: "var(--color-k-navy)", color: "white", fontSize: 11, fontWeight: 700, cursor: "pointer",
                          }}
                        >
                          승인
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: "var(--color-k-text-secondary)" }}>-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
