"use client";

import React from "react";
import { AdminEmptyState } from "./AdminEmptyState";
import { AdminErrorState } from "./AdminErrorState";

export interface AdminDataTableColumn<T> {
  key: string;
  header: React.ReactNode;
  render: (row: T) => React.ReactNode;
  width?: string | number;
}

export interface AdminDataTableProps<T> {
  columns: AdminDataTableColumn<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  isLoading?: boolean;
  error?: Error | string | null;
  onRetry?: () => void;
  density?: "comfortable" | "compact";
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  emptyDescription?: string;
}

export function AdminDataTable<T>({
  columns,
  data,
  keyExtractor,
  isLoading,
  error,
  onRetry,
  density = "compact",
  onRowClick,
  emptyMessage = "현재 표시할 항목이 없습니다.",
  emptyDescription,
}: AdminDataTableProps<T>) {
  if (error) {
    return <AdminErrorState onRetry={onRetry} error={typeof error === "string" ? error : (error as Error).message} />;
  }

  if (isLoading && data.length === 0) {
    // Skeleton
    return (
      <div style={{ width: "100%", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} style={{ padding: "var(--admin-space-12) var(--admin-space-16)", borderBottom: "1px solid var(--admin-border)", color: "var(--admin-text-secondary)" }}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {columns.map((col) => (
                  <td key={col.key} style={{ padding: "var(--admin-space-12) var(--admin-space-16)", borderBottom: "1px solid var(--admin-border)" }}>
                    <div style={{ height: 20, background: "var(--admin-border)", borderRadius: 4, opacity: 0.5 }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (data.length === 0) {
    return <AdminEmptyState message={emptyMessage} description={emptyDescription} />;
  }

  const rowHeight = density === "comfortable" ? 56 : 48; // 44~48px
  const paddingV = density === "comfortable" ? "var(--admin-space-16)" : "var(--admin-space-12)";
  const paddingH = "var(--admin-space-16)";

  return (
    <div style={{ width: "100%", overflowX: "auto", border: "1px solid var(--admin-border)", borderRadius: 8, background: "var(--admin-surface)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "var(--admin-text-sm)" }}>
        <caption style={{ display: "none" }}>데이터 테이블</caption>
        <thead style={{ position: "sticky", top: 0, background: "var(--admin-bg)", zIndex: 10 }}>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                style={{
                  padding: `${paddingV} ${paddingH}`,
                  borderBottom: "1px solid var(--admin-border)",
                  color: "var(--admin-text-secondary)",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  width: col.width
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={keyExtractor(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === "Enter") onRowClick(row); } : undefined}
              style={{
                height: rowHeight,
                borderBottom: i === data.length - 1 ? "none" : "1px solid var(--admin-border)",
                cursor: onRowClick ? "pointer" : "default",
                background: "var(--admin-surface)"
              }}
              className="admin-table-row"
            >
              {columns.map((col) => (
                <td key={col.key} style={{ padding: `${paddingV} ${paddingH}`, color: "var(--admin-text-primary)" }}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <style>{`
        .admin-table-row:hover {
          background-color: var(--admin-bg) !important;
        }
        .admin-table-row:focus-visible {
          outline: 2px solid var(--admin-focus);
          outline-offset: -2px;
        }
      `}</style>
    </div>
  );
}
