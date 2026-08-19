"use client";

import React from "react";
import { AdminEmptyState } from "./AdminEmptyState";
import { AdminErrorState } from "./AdminErrorState";

export type AdminDataTableSortType = "text" | "number" | "date";

export interface AdminDataTableColumn<T> {
  key: string;
  header: React.ReactNode;
  render: (row: T) => React.ReactNode;
  width?: string | number;
  /** 이 컬럼으로 정렬할 수 있는지. 기본 false — 선택/체크박스/액션 컬럼은 켜지 않는다. */
  sortable?: boolean;
  /** 정렬에 쓸 원시값. sortable 이 true 면 반드시 준다. */
  sortValue?: (row: T) => string | number | null | undefined;
  /** 첫 클릭 방향과 비교 방식을 정한다. 기본 "text". */
  sortType?: AdminDataTableSortType;
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
  expandedRowRender?: (row: T) => React.ReactNode;
  expandedRowIds?: Set<string>;
  /** 주면 controlled 모드. 컴포넌트는 스스로 정렬하지 않고 클릭만 알려준다. */
  sort?: { key: string; direction: "asc" | "desc" } | null;
  onSortChange?: (next: { key: string; direction: "asc" | "desc" }) => void;
}

function isEmptySortValue(val: unknown, sortType: AdminDataTableSortType): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === "string" && val.trim() === "") return true;
  if (sortType === "number") {
    if (typeof val === "number") return isNaN(val);
    const n = Number(val);
    return isNaN(n);
  }
  if (sortType === "date") {
    if (val instanceof Date) return isNaN(val.getTime());
    if (typeof val === "number") return isNaN(val);
    const ts = Date.parse(String(val));
    return isNaN(ts);
  }
  return false;
}

function compareSortValues(
  a: unknown,
  b: unknown,
  sortType: AdminDataTableSortType,
  direction: "asc" | "desc"
): number {
  const emptyA = isEmptySortValue(a, sortType);
  const emptyB = isEmptySortValue(b, sortType);

  if (emptyA && emptyB) return 0;
  if (emptyA) return 1;
  if (emptyB) return -1;

  let diff = 0;
  if (sortType === "number") {
    const numA = typeof a === "number" ? a : Number(a);
    const numB = typeof b === "number" ? b : Number(b);
    diff = numA - numB;
  } else if (sortType === "date") {
    const tsA = a instanceof Date ? a.getTime() : typeof a === "number" ? a : Date.parse(String(a));
    const tsB = b instanceof Date ? b.getTime() : typeof b === "number" ? b : Date.parse(String(b));
    diff = tsA - tsB;
  } else {
    const strA = String(a);
    const strB = String(b);
    diff = strA.localeCompare(strB, "ko", { sensitivity: "base" }) || strA.localeCompare(strB, "ko");
  }

  return direction === "asc" ? diff : -diff;
}

export function getNextSortDirection(
  currentSort: { key: string; direction: "asc" | "desc" } | null | undefined,
  targetColumnKey: string,
  targetSortType?: AdminDataTableSortType
): { key: string; direction: "asc" | "desc" } {
  const defaultDir: "asc" | "desc" = targetSortType === "number" || targetSortType === "date" ? "desc" : "asc";
  let nextDir: "asc" | "desc" = defaultDir;
  if (currentSort && currentSort.key === targetColumnKey) {
    nextDir = currentSort.direction === "asc" ? "desc" : "asc";
  }
  return { key: targetColumnKey, direction: nextDir };
}

export function AdminDataTable<T>({
  columns: rawColumns,
  data: rawData,
  keyExtractor,
  isLoading,
  error,
  onRetry,
  density = "compact",
  onRowClick,
  emptyMessage = "현재 표시할 항목이 없습니다.",
  emptyDescription,
  expandedRowRender,
  expandedRowIds = new Set(),
  sort,
  onSortChange,
}: AdminDataTableProps<T>) {
  // API 롤링 배포나 구버전 캐시가 잘못된 shape를 넘겨도 관리자 전체 화면을
  // client exception으로 무너뜨리지 않는다. 호출 화면의 error prop은 별도로
  // 유지하므로 실제 API 실패가 빈 목록으로 숨겨지지는 않는다.
  const columns = Array.isArray(rawColumns) ? rawColumns : [];
  const data = Array.isArray(rawData) ? rawData : [];

  const [internalSort, setInternalSort] = React.useState<{ key: string; direction: "asc" | "desc" } | null>(sort ?? null);

  const isControlled = typeof onSortChange === "function";
  const activeSort = isControlled ? (sort ?? null) : internalSort;

  const handleHeaderClick = (col: AdminDataTableColumn<T>) => {
    if (!col.sortable) return;
    const next = getNextSortDirection(activeSort, col.key, col.sortType);
    if (isControlled && onSortChange) {
      onSortChange(next);
    } else {
      setInternalSort(next);
    }
  };

  const sortedData = React.useMemo(() => {
    if (isControlled || !activeSort) return data;
    const targetCol = columns.find((c) => c.key === activeSort.key);
    if (!targetCol || !targetCol.sortable) return data;

    const getVal = targetCol.sortValue
      ? targetCol.sortValue
      : (row: T) => (row as Record<string, unknown>)[targetCol.key] as string | number | null | undefined;

    const sortType = targetCol.sortType ?? "text";
    const direction = activeSort.direction;

    return [...data].sort((a, b) => {
      const valA = getVal(a);
      const valB = getVal(b);
      return compareSortValues(valA, valB, sortType, direction);
    });
  }, [data, columns, activeSort, isControlled]);

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
            {columns.map((col) => {
              const isSortable = Boolean(col.sortable);
              const isSorted = activeSort?.key === col.key;
              const sortDirection = isSorted ? activeSort?.direction : undefined;

              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={isSorted ? (sortDirection === "asc" ? "ascending" : "descending") : isSortable ? "none" : undefined}
                  data-sortable={isSortable ? "true" : undefined}
                  data-sort-direction={sortDirection}
                  style={{
                    padding: `${paddingV} ${paddingH}`,
                    borderBottom: "1px solid var(--admin-border)",
                    color: "var(--admin-text-secondary)",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    width: col.width,
                  }}
                >
                  {isSortable ? (
                    <button
                      type="button"
                      onClick={() => handleHeaderClick(col)}
                      data-sortable="true"
                      data-sort-direction={sortDirection}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "var(--admin-space-4, 4px)",
                        background: "none",
                        border: "none",
                        padding: 0,
                        margin: 0,
                        font: "inherit",
                        color: "inherit",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span>{col.header}</span>
                      <span aria-hidden="true" style={{ fontSize: "0.75em", lineHeight: 1, userSelect: "none" }}>
                        {isSorted ? (sortDirection === "asc" ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row, i) => (
            <React.Fragment key={keyExtractor(row)}>
              <tr
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === "Enter") onRowClick(row); } : undefined}
                style={{
                  height: rowHeight,
                  borderBottom: (i === sortedData.length - 1 && !expandedRowRender) ? "none" : "1px solid var(--admin-border)",
                  cursor: onRowClick ? "pointer" : "default",
                  background: expandedRowIds.has(keyExtractor(row)) ? "var(--admin-focus)" : "var(--admin-surface)",
                }}
                className="admin-table-row"
              >
                {columns.map((col) => (
                  <td key={col.key} style={{ padding: `${paddingV} ${paddingH}`, color: "var(--admin-text-primary)" }}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
              {expandedRowRender && expandedRowIds.has(keyExtractor(row)) && (
                <tr>
                  <td colSpan={columns.length} style={{ padding: 0, borderBottom: i === sortedData.length - 1 ? "none" : "1px solid var(--admin-border)" }}>
                    <div style={{ animation: "hbAccordionIn 0.18s ease" }}>
                      {expandedRowRender(row)}
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
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
