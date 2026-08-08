"use client";

import { useState, useEffect, useCallback } from "react";
import { AdminResponsiveTable } from "@/components/admin/shell/AdminResponsiveTable";
import { AdminFilterBar } from "@/components/admin/shell/AdminFilterBar";
import { AdminStatusBadge, type AdminStatusVariant } from "@/components/admin/shell/AdminStatusBadge";
import {
  SoftDeleteButton,
  SoftDeleteRowCheckbox,
  SoftDeleteSelectionBar,
  useAdminSoftDelete,
} from "@/components/admin/AdminSoftDelete";

interface RewardRow {
  id: string;
  event_type: string;
  child_id: string;
  childName: string | null;
  loginId: string;
  familyName: string;
  isInternalTest: boolean;
  reward_amount: number;
  status: "pending" | "approved" | "scheduled" | "delivered" | "on_hold" | "cancelled";
  delivery_method: string;
  approved_at: string | null;
  delivered_at: string | null;
  admin_note: string | null;
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "지급 대상 확인", approved: "승인됨", scheduled: "전달 예정", delivered: "전달 완료", on_hold: "보류", cancelled: "취소",
};
const STATUS_VARIANT: Record<string, AdminStatusVariant> = {
  pending: "warning", approved: "info", scheduled: "info", delivered: "success", on_hold: "neutral", cancelled: "danger",
};
const EVENT_TYPE_LABELS: Record<string, string> = { mission_onboarding: "미션 30일", quiz_leaderboard: "퀴즈 리더보드" };

const NEXT_ACTION: Record<string, { label: string; nextStatus: string } | null> = {
  pending: { label: "승인", nextStatus: "approved" },
  approved: { label: "전달 예정으로 변경", nextStatus: "scheduled" },
  scheduled: { label: "전달 완료 처리", nextStatus: "delivered" },
  on_hold: { label: "재개(대기로)", nextStatus: "pending" },
  delivered: null,
  cancelled: null,
};

function won(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}
function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR");
}

export default function RewardFulfillmentsTab({
  includeTestAccounts = false,
  externalSearch = "",
  initialStatus = "all",
}: {
  includeTestAccounts?: boolean;
  externalSearch?: string;
  initialStatus?: string;
} = {}) {
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus);
  const [rows, setRows] = useState<RewardRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [selected, setSelected] = useState<RewardRow | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (includeTestAccounts) params.set("includeTestAccounts", "true");
    const qs = params.size ? `?${params.toString()}` : "";
    fetch(`/api/admin/events/reward-fulfillments${qs}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [includeTestAccounts, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleTransition = async (row: RewardRow, nextStatus: string) => {
    let adminNote: string | undefined;
    if (nextStatus === "delivered") {
      const confirmed = window.confirm(
        `${row.childName || "이름 미등록"}에게 ${won(row.reward_amount)}을(를) 오프라인으로 전달 완료 처리할까요?\n(실제 전달이 완료된 후에만 눌러주세요)`
      );
      if (!confirmed) return;
      adminNote = window.prompt("전달 관련 메모(선택):") ?? undefined;
    } else if (nextStatus === "on_hold" || (row.status !== "pending" && nextStatus === "cancelled")) {
      adminNote = window.prompt("사유를 입력하세요(선택):") ?? undefined;
    }

    setActionLoading(row.id);
    try {
      const res = await fetch(`/api/admin/events/reward-fulfillments/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, adminNote }),
      });
      if (res.ok) {
        load();
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "처리에 실패했습니다.");
        load();
      }
    } catch {
      alert("오류가 발생했습니다.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleHold = async (row: RewardRow) => {
    await handleTransition(row, "on_hold");
  };

  // requests/066 소프트 삭제 — 이벤트·상품권 지급 처리 이력(event_reward_fulfillments).
  // 주의: 삭제 대상은 "지급 처리 이력" 행이며, 황금열쇠 원장이나 아이 계정은 대상이 아니다.
  const softDelete = useAdminSoftDelete(
    "event_reward_fulfillments",
    "이벤트·상품권 지급 이력",
    load,
    statusFilter !== "all" ? `상태=${statusFilter}` : ""
  );
  const pageRows = rows ?? [];
  const toTarget = (row: any) => ({
    id: row.id as string,
    identity: `${row.childName || "이름 미등록"} / ${EVENT_TYPE_LABELS[row.event_type] ?? row.event_type}`,
    summary: won(row.reward_amount),
    status: STATUS_LABELS[row.status] ?? row.status,
  });

  const visibleRows = pageRows.filter((row) => {
    if (eventTypeFilter === "other" && ["mission_onboarding", "quiz_leaderboard"].includes(row.event_type)) return false;
    if (!["all", "other"].includes(eventTypeFilter) && row.event_type !== eventTypeFilter) return false;
    const needle = externalSearch.trim().toLocaleLowerCase("ko");
    return !needle || [row.childName, row.loginId, row.familyName].join(" ").toLocaleLowerCase("ko").includes(needle);
  });
  const pageIds = visibleRows.map((row: any) => row.id as string);
  const allSelected = pageIds.length > 0 && pageIds.every((id: string) => softDelete.isSelected(id));

  return (
    <div>
      <h2 style={{ fontSize: "var(--admin-text-lg)", fontWeight: "var(--admin-weight-bold)", color: "var(--admin-text-primary)", marginBottom: "var(--admin-space-12)" }}>
        상품권 지급 관리
      </h2>
      <p style={{ fontSize: "var(--admin-text-xs)", color: "var(--admin-text-secondary)", marginBottom: "var(--admin-space-12)" }}>
        자동 발송 연동 없음 — 오프라인으로 직접 전달 후 &quot;전달 완료&quot;로 기록합니다.
      </p>

      <AdminFilterBar
        filterNodes={[
            ...(["all", "pending", "approved", "scheduled", "delivered", "on_hold", "cancelled"] as const).map((s) => (
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
            )),
            <select
              key="event-type"
              aria-label="이벤트 출처"
              value={eventTypeFilter}
              onChange={(event) => setEventTypeFilter(event.target.value)}
              style={{ minHeight: 38, padding: "var(--admin-space-6) var(--admin-space-12)", borderRadius: 8, border: "1px solid var(--admin-border)" }}
            >
              <option value="all">모든 이벤트 출처</option>
              <option value="mission_onboarding">미션 30일</option>
              <option value="quiz_leaderboard">퀴즈 리더보드</option>
              <option value="other">기타</option>
            </select>,
        ]}
      />

      <div style={{ marginTop: "var(--admin-space-16)" }}>
        <SoftDeleteSelectionBar
          selectedCount={softDelete.selectedIds.length}
          totalCount={pageIds.length}
          allSelected={allSelected}
          onSelectAll={(checked) => softDelete.setPageSelection(pageIds, checked)}
          onClear={softDelete.clearSelection}
          onBulkDelete={() => softDelete.requestBulkDelete(visibleRows.filter((r: any) => softDelete.isSelected(r.id)).map(toTarget))}
          disabled={softDelete.busy}
        />
        <AdminResponsiveTable mobileStrategy="card"
          columns={[
            { key: "select", header: "선택", render: (row) => (
              <SoftDeleteRowCheckbox checked={softDelete.isSelected(row.id)} onChange={() => softDelete.toggleSelected(row.id)} />
            ) },
            { key: "event_type", header: "이벤트 유형", render: (row) => EVENT_TYPE_LABELS[row.event_type] },
            { key: "child", header: "아이", render: (row) => (
              <div>
                <a
                  href={`/admin/users?tab=children&search=${encodeURIComponent(row.childName || row.loginId)}`}
                  onClick={(event) => event.stopPropagation()}
                  style={{ fontWeight: 700, color: "var(--admin-primary)", textDecoration: "none" }}
                >
                  {row.childName || "이름 미등록"}
                </a>
                {row.isInternalTest && <span style={{ marginLeft: 6 }}><AdminStatusBadge text="[테스트]" variant="neutral" /></span>}
                <div style={{ color: "var(--admin-text-secondary)", fontSize: "var(--admin-text-xs)" }}>{row.loginId} · {row.familyName}</div>
              </div>
            ) },
            { key: "amount", header: "지급 금액", render: (row) => won(row.reward_amount) },
            { key: "status", header: "상태", render: (row) => <AdminStatusBadge text={STATUS_LABELS[row.status]} variant={STATUS_VARIANT[row.status]} /> },
            { key: "approved_at", header: "승인 시각", render: (row) => formatDateTime(row.approved_at) },
            { key: "delivered_at", header: "전달 시각", render: (row) => formatDateTime(row.delivered_at) },
            { key: "note", header: "메모", render: (row) => row.admin_note ?? "-" },
            {
              key: "action", header: "액션", render: (row) => {
                const action = NEXT_ACTION[row.status];
                return (
                  <div style={{ display: "flex", gap: 6 }} onClick={(event) => event.stopPropagation()}>
                    {action && (
                      <button
                        onClick={() => handleTransition(row, action.nextStatus)}
                        disabled={actionLoading === row.id}
                        style={{
                          padding: "var(--admin-space-6) var(--admin-space-12)", borderRadius: 8, border: "none",
                          background: "var(--admin-focus)", color: "white", fontSize: "var(--admin-text-xs)", fontWeight: "var(--admin-weight-bold)", cursor: "pointer",
                        }}
                      >
                        {action.label}
                      </button>
                    )}
                    {(row.status === "pending" || row.status === "approved" || row.status === "scheduled") && (
                      <button
                        onClick={() => handleHold(row)}
                        disabled={actionLoading === row.id}
                        style={{
                          padding: "var(--admin-space-6) var(--admin-space-12)", borderRadius: 8, border: "1px solid var(--admin-border)",
                          background: "white", color: "var(--admin-text-secondary)", fontSize: "var(--admin-text-xs)", fontWeight: "var(--admin-weight-bold)", cursor: "pointer",
                        }}
                      >
                        보류
                      </button>
                    )}
                    <SoftDeleteButton
                      disabled={softDelete.busy}
                      onClick={(e) => { e.stopPropagation(); softDelete.requestDelete(toTarget(row)); }}
                    />
                  </div>
                );
              },
            },
          ]}
          data={visibleRows}
          isLoading={loading}
          keyExtractor={(row) => row.id}
          onRowClick={setSelected}
          emptyMessage="표시할 지급 건이 없습니다."
        />
      </div>

      {softDelete.modals}
      {selected && (
        <div className="fixed inset-0 z-[200] flex justify-end bg-black/40" onClick={() => setSelected(null)}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="지급 상세"
            className="h-full w-full overflow-y-auto bg-white p-6 shadow-2xl sm:max-w-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" className="float-right min-h-11 min-w-11" aria-label="상세 닫기" onClick={() => setSelected(null)}>✕</button>
            <h3 className="mb-6 text-xl font-black">{selected.childName || "이름 미등록"}</h3>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <dt>로그인 ID</dt><dd>{selected.loginId}</dd>
              <dt>가족</dt><dd>{selected.familyName}</dd>
              <dt>이벤트 출처</dt><dd>{EVENT_TYPE_LABELS[selected.event_type] ?? "기타"}</dd>
              <dt>지급 금액</dt><dd>{won(selected.reward_amount)}</dd>
              <dt>현재 상태</dt><dd>{STATUS_LABELS[selected.status]}</dd>
              <dt>전달 방식</dt><dd>{selected.delivery_method === "offline" ? "오프라인 전달" : selected.delivery_method}</dd>
              <dt>승인 시각</dt><dd>{formatDateTime(selected.approved_at)}</dd>
              <dt>전달 완료 시각</dt><dd>{formatDateTime(selected.delivered_at)}</dd>
              <dt>관리자 메모</dt><dd>{selected.admin_note ?? "-"}</dd>
            </dl>
            <a className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-[var(--admin-primary)] px-4 font-bold text-white" href={`/admin/users?tab=children&search=${encodeURIComponent(selected.childName || selected.loginId)}`}>사용자 관리에서 보기</a>
          </aside>
        </div>
      )}
    </div>
  );
}
