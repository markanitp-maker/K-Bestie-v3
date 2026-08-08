"use client";

import { useState, useEffect, useCallback } from "react";
import { AdminDataTable } from "@/components/admin/shell/AdminDataTable";
import { AdminResponsiveTable } from "@/components/admin/shell/AdminResponsiveTable";
import { AdminFilterBar } from "@/components/admin/shell/AdminFilterBar";
import { AdminStatusBadge, type AdminStatusVariant } from "@/components/admin/shell/AdminStatusBadge";

interface EventRow {
  id: string;
  child_id: string;
  childName: string | null;
  loginId: string;
  familyName: string;
  isInternalTest: boolean;
  status: "active" | "max_completed" | "completed";
  started_at: string;
  ends_at: string;
  completed_at: string | null;
  mission_completed_count: number;
  final_mission_count: number | null;
  current_reward_amount: number;
  final_reward_amount: number | null;
}

const STATUS_LABELS: Record<string, string> = { active: "진행 중", max_completed: "최고 달성", completed: "종료" };
const STATUS_VARIANT: Record<string, AdminStatusVariant> = { active: "info", max_completed: "success", completed: "neutral" };

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR");
}
function won(n: number | null): string {
  return `${(n ?? 0).toLocaleString("ko-KR")}원`;
}

export default function MissionOnboardingEventsTab({
  includeTestAccounts = false,
  externalSearch = "",
}: {
  includeTestAccounts?: boolean;
  externalSearch?: string;
} = {}) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<EventRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (includeTestAccounts) params.set("includeTestAccounts", "true");
    const qs = params.size ? `?${params.toString()}` : "";
    fetch(`/api/admin/events/mission-onboarding${qs}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [includeTestAccounts, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = (rows ?? []).filter((row) => {
    const needle = [externalSearch, search].filter(Boolean).join(" ").trim().toLocaleLowerCase("ko");
    if (!needle) return true;
    return [row.childName, row.loginId, row.familyName].join(" ").toLocaleLowerCase("ko").includes(needle);
  });

  return (
    <div>
      <h2 style={{ fontSize: "var(--admin-text-lg)", fontWeight: "var(--admin-weight-bold)", color: "var(--admin-text-primary)", marginBottom: "var(--admin-space-12)" }}>
        미션 이벤트
      </h2>

      <AdminFilterBar
        searchNode={
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="아이 이름 검색"
            style={{ width: "100%", padding: "var(--admin-space-8) var(--admin-space-12)", fontSize: "var(--admin-text-sm)", borderRadius: 8, border: "1px solid var(--admin-border)" }}
          />
        }
        filterNodes={(["all", "active", "max_completed", "completed"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              padding: "var(--admin-space-6) var(--admin-space-12)", borderRadius: 8, fontSize: "var(--admin-text-sm)",
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
        <AdminResponsiveTable mobileStrategy="card"
          columns={[
            { key: "child", header: "아이", render: (row) => (
              <div>
                <div style={{ fontWeight: 700 }}>{row.childName || "이름 미등록"}{row.isInternalTest ? " · 테스트" : ""}</div>
                <div style={{ color: "var(--admin-text-secondary)", fontSize: "var(--admin-text-xs)" }}>{row.loginId} · {row.familyName}</div>
              </div>
            ) },
            { key: "status", header: "상태", render: (row) => <AdminStatusBadge text={STATUS_LABELS[row.status]} variant={STATUS_VARIANT[row.status]} /> },
            { key: "started_at", header: "최초 미션 완료", render: (row) => formatDateTime(row.started_at) },
            { key: "ends_at", header: "종료 시각", render: (row) => formatDateTime(row.ends_at) },
            { key: "count", header: "완료 횟수", render: (row) => `${row.mission_completed_count}/60` },
            { key: "current_reward", header: "현재 구간", render: (row) => won(row.current_reward_amount) },
            { key: "final_reward", header: "최종 지급액", render: (row) => (row.final_reward_amount != null ? won(row.final_reward_amount) : "-") },
          ]}
          data={filtered}
          isLoading={loading}
          keyExtractor={(row) => row.id}
          emptyMessage="표시할 이벤트가 없습니다."
        />
      </div>
    </div>
  );
}
