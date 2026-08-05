"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AdminPageHeader } from "@/components/admin/shell/AdminPageHeader";
import { AdminFilterBar } from "@/components/admin/shell/AdminFilterBar";
import { AdminResponsiveTable } from "@/components/admin/shell/AdminResponsiveTable";
import type { AdminDataTableColumn } from "@/components/admin/shell/AdminDataTable";
import { AdminStatusBadge } from "@/components/admin/shell/AdminStatusBadge";
import { SoftDeleteRowCheckbox } from "@/components/admin/AdminSoftDelete";

/**
 * 관리자 휴지통 (requests/066 §5)
 *
 * 소프트 삭제된 "관리자 운영 요청 데이터"만 통합 조회한다. 부모·아이·가족 계정,
 * 대화·미션·리포트·원장 데이터는 애초에 삭제 대상이 아니므로 여기에 나타나지 않는다.
 */

interface TrashItem {
  resource: string;
  resourceLabel: string;
  id: string;
  title: string;
  originalStatus: string | null;
  createdAt: string | null;
  deletedAt: string;
  deletedBy: string | null;
  deletedByEmail: string | null;
  deleteReason: string | null;
  permanentDeleteAt: string;
  remainingDays: number;
}

interface ResourceCount {
  resource: string;
  label: string;
  count: number;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR");
}

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("ko-KR");
}

const inputStyle: React.CSSProperties = {
  padding: "var(--admin-space-6) var(--admin-space-10)",
  borderRadius: 8,
  border: "1px solid var(--admin-border)",
  fontSize: "var(--admin-text-sm)",
  background: "var(--admin-surface)",
  color: "var(--admin-text-primary)",
};

export default function TrashTab() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [counts, setCounts] = useState<ResourceCount[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [resource, setResource] = useState("all");
  const [deletedFrom, setDeletedFrom] = useState("");
  const [deletedTo, setDeletedTo] = useState("");
  const [reasonSearch, setReasonSearch] = useState("");
  const [deletedBy, setDeletedBy] = useState("");

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (resource !== "all") params.set("resource", resource);
    if (deletedFrom) params.set("deletedFrom", new Date(deletedFrom).toISOString());
    if (deletedTo) {
      // 종료일은 그날 끝까지 포함한다.
      const end = new Date(deletedTo);
      end.setHours(23, 59, 59, 999);
      params.set("deletedTo", end.toISOString());
    }
    if (reasonSearch) params.set("reason", reasonSearch);
    if (deletedBy) params.set("deletedBy", deletedBy);

    fetch(`/api/admin/trash?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        setItems(Array.isArray(d.items) ? d.items : []);
        setCounts(Array.isArray(d.countsByResource) ? d.countsByResource : []);
        setSelected(new Set());
      })
      .catch(() => setToast({ type: "error", text: "휴지통을 불러오지 못했습니다." }))
      .finally(() => setLoading(false));
  }, [resource, deletedFrom, deletedTo, reasonSearch, deletedBy]);

  useEffect(() => {
    load();
  }, [load]);

  const key = (item: TrashItem) => `${item.resource}:${item.id}`;

  const restore = useCallback(
    async (targets: TrashItem[]) => {
      if (busy || targets.length === 0) return;
      setBusy(true);
      try {
        // 리소스별로 묶어서 호출한다(엔드포인트가 리소스 단위 화이트리스트 검증을 한다).
        const byResource = new Map<string, string[]>();
        for (const target of targets) {
          const list = byResource.get(target.resource) ?? [];
          list.push(target.id);
          byResource.set(target.resource, list);
        }

        const results = await Promise.allSettled(
          Array.from(byResource.entries()).map(async ([res, ids]) => {
            const response = await fetch("/api/admin/trash/restore", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ resource: res, ids }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || "복구 실패");
            return data as { restoredCount: number; skippedCount: number };
          })
        );

        const restored = results.reduce(
          (sum, r) => sum + (r.status === "fulfilled" ? r.value.restoredCount : 0),
          0
        );
        const skipped = results.reduce(
          (sum, r) => sum + (r.status === "fulfilled" ? r.value.skippedCount : 0),
          0
        );
        const failed = results.filter((r) => r.status === "rejected").length;

        setToast({
          type: failed > 0 ? "error" : "success",
          text: `복구 ${restored}건 · 건너뜀 ${skipped}건${failed > 0 ? ` · 실패 ${failed}건` : ""}`,
        });
        load();
      } finally {
        setBusy(false);
      }
    },
    [busy, load]
  );

  const selectedItems = useMemo(() => items.filter((item) => selected.has(key(item))), [items, selected]);
  const allSelected = items.length > 0 && items.every((item) => selected.has(key(item)));

  const columns: AdminDataTableColumn<TrashItem>[] = [
    {
      key: "select",
      header: "선택",
      render: (item) => (
        <SoftDeleteRowCheckbox
          checked={selected.has(key(item))}
          onChange={() =>
            setSelected((prev) => {
              const next = new Set(prev);
              const k = key(item);
              if (next.has(k)) next.delete(k);
              else next.add(k);
              return next;
            })
          }
        />
      ),
    },
    { key: "resourceLabel", header: "유형", render: (item) => item.resourceLabel },
    { key: "title", header: "대상", render: (item) => item.title },
    {
      key: "originalStatus",
      header: "원래 상태",
      render: (item) => (item.originalStatus ? <AdminStatusBadge text={item.originalStatus} variant="neutral" /> : "-"),
    },
    { key: "createdAt", header: "등록일", render: (item) => formatDate(item.createdAt) },
    { key: "deletedAt", header: "삭제일", render: (item) => formatDateTime(item.deletedAt) },
    { key: "deletedBy", header: "삭제자", render: (item) => item.deletedByEmail || item.deletedBy || "-" },
    { key: "deleteReason", header: "삭제 사유", render: (item) => item.deleteReason || "-" },
    {
      key: "remaining",
      header: "복구 가능",
      render: (item) => (
        <div style={{ fontSize: 12 }}>
          <div style={{ fontWeight: 700, color: item.remainingDays <= 3 ? "#dc2626" : undefined }}>
            {item.remainingDays}일 남음
          </div>
          <div style={{ color: "var(--admin-text-secondary)" }}>영구 삭제 예정 {formatDate(item.permanentDeleteAt)}</div>
        </div>
      ),
    },
    {
      key: "actions",
      header: "액션",
      render: (item) => (
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            restore([item]);
          }}
          style={{
            padding: "6px 12px",
            borderRadius: 8,
            border: "none",
            background: "var(--admin-primary)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.5 : 1,
          }}
        >
          복구
        </button>
      ),
    },
  ];

  return (
    <div style={{ width: "100%" }}>
      {toast && (
        <div
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            zIndex: 100,
            padding: "10px 16px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 700,
            color: "#fff",
            background: toast.type === "success" ? "var(--admin-primary)" : "#dc2626",
          }}
        >
          {toast.text}
        </div>
      )}

      <AdminPageHeader
        title="휴지통"
        description="삭제된 관리자 운영 요청 데이터입니다. 삭제일로부터 30일 이내에 복구할 수 있고, 이후에는 자동으로 영구 삭제됩니다. 부모·아이·가족 계정, 대화·미션·리포트 데이터는 삭제 대상이 아니어서 여기에 표시되지 않습니다."
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: "var(--admin-space-12)" }}>
        {counts.map((c) => (
          <div
            key={c.resource}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid var(--admin-border)",
              background: "var(--admin-surface)",
              fontSize: 13,
            }}
          >
            {c.label} <b>{c.count}</b>건
          </div>
        ))}
      </div>

      <AdminFilterBar
        searchNode={
          <input
            type="text"
            placeholder="삭제 사유 검색"
            value={reasonSearch}
            onChange={(e) => setReasonSearch(e.target.value)}
            style={{ ...inputStyle, width: "100%", minWidth: 220 }}
          />
        }
        filterNodes={[
          <select key="resource" value={resource} onChange={(e) => setResource(e.target.value)} style={inputStyle}>
            <option value="all">모든 유형</option>
            {counts.map((c) => (
              <option key={c.resource} value={c.resource}>
                {c.label}
              </option>
            ))}
          </select>,
          <input
            key="from"
            type="date"
            value={deletedFrom}
            onChange={(e) => setDeletedFrom(e.target.value)}
            title="삭제일 시작"
            style={inputStyle}
          />,
          <input
            key="to"
            type="date"
            value={deletedTo}
            onChange={(e) => setDeletedTo(e.target.value)}
            title="삭제일 종료"
            style={inputStyle}
          />,
          <input
            key="deletedBy"
            type="text"
            placeholder="삭제자 ID"
            value={deletedBy}
            onChange={(e) => setDeletedBy(e.target.value)}
            style={inputStyle}
          />,
        ]}
      />

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          padding: "8px 12px",
          borderRadius: 8,
          border: "1px solid var(--admin-border)",
          background: "var(--admin-surface)",
          margin: "var(--admin-space-16) 0 12px",
          fontSize: 13,
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={allSelected}
            disabled={items.length === 0}
            onChange={(e) =>
              setSelected(e.target.checked ? new Set(items.map(key)) : new Set())
            }
          />
          현재 목록 전체 선택 ({items.length}건)
        </label>
        <span style={{ fontWeight: 700 }}>선택 {selectedItems.length}건</span>
        <button
          type="button"
          disabled={busy || selectedItems.length === 0}
          onClick={() => restore(selectedItems)}
          style={{
            padding: "6px 12px",
            borderRadius: 8,
            border: "none",
            background: selectedItems.length === 0 ? "#f3f4f6" : "var(--admin-primary)",
            color: selectedItems.length === 0 ? "#9ca3af" : "#fff",
            fontSize: 12,
            fontWeight: 700,
            cursor: selectedItems.length === 0 || busy ? "not-allowed" : "pointer",
          }}
        >
          선택 복구
        </button>
      </div>

      <AdminResponsiveTable
        mobileStrategy="card"
        columns={columns}
        data={items}
        isLoading={loading}
        keyExtractor={(item) => key(item)}
        emptyMessage="휴지통이 비어 있습니다."
      />
    </div>
  );
}
