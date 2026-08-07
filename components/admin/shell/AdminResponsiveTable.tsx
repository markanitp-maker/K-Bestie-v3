"use client";

import React from "react";
import { AdminDataTable, type AdminDataTableProps } from "./AdminDataTable";
import { AdminMobileListCard } from "./AdminMobileListCard";
import { AdminErrorState } from "./AdminErrorState";

export interface AdminResponsiveTableProps<T> extends AdminDataTableProps<T> {
  // Mobile specific strategy
  mobileStrategy?: "scroll" | "card" | "stacked" | "hide";
  // Render function for mobile card view
  renderMobileCard?: (row: T) => React.ReactNode;
}

export function AdminResponsiveTable<T>(props: AdminResponsiveTableProps<T>) {
  const { mobileStrategy = "scroll", renderMobileCard, ...tableProps } = props;
  const safeData = Array.isArray(tableProps.data) ? tableProps.data : [];
  const safeColumns = Array.isArray(tableProps.columns) ? tableProps.columns : [];
  const safeTableProps = { ...tableProps, data: safeData, columns: safeColumns };

  return (
    <>
      <div className={mobileStrategy !== "scroll" ? "max-lg:hidden" : ""}>
        <AdminDataTable {...safeTableProps} />
      </div>

      {mobileStrategy !== "scroll" && (
        <div className="lg:hidden">
          {safeTableProps.error ? (
            <AdminErrorState onRetry={safeTableProps.onRetry} error={typeof safeTableProps.error === "string" ? safeTableProps.error : safeTableProps.error.message} />
          ) : safeTableProps.isLoading && safeData.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} style={{ height: 80, background: "var(--admin-surface)", borderRadius: 12, border: "1px solid var(--admin-border)", opacity: 0.5 }} />
              ))}
            </div>
          ) : safeData.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--admin-text-secondary)", background: "var(--admin-surface)", borderRadius: 12, border: "1px dashed var(--admin-border)" }}>
              {safeTableProps.emptyMessage || "현재 표시할 항목이 없습니다."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {safeData.map((row) => {
                const actionsCol = safeColumns.find(c => c.key === "actions" || c.key === "action");
                const otherCols = safeColumns.slice(1).filter(c => c !== actionsCol);
                
                const onClick = safeTableProps.onRowClick ? () => safeTableProps.onRowClick!(row) : undefined;

                return (
                  <div
                    key={safeTableProps.keyExtractor(row)}
                    onClick={onClick}
                    role={onClick ? "button" : undefined}
                    tabIndex={onClick ? 0 : undefined}
                    onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
                    style={onClick ? { cursor: "pointer" } : undefined}
                  >
                    {renderMobileCard ? renderMobileCard(row) : (
                      <AdminMobileListCard
                        title={safeColumns[0]?.render(row)}
                        content={
                          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            {otherCols.map(col => (
                              <div key={col.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                                <div style={{ fontSize: "12px", color: "var(--admin-text-secondary)", whiteSpace: "nowrap" }}>
                                  {col.header}
                                </div>
                                <div style={{ textAlign: "right", wordBreak: "break-word", flex: 1 }}>
                                  {col.render(row)}
                                </div>
                              </div>
                            ))}
                          </div>
                        }
                        actions={
                          actionsCol ? (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              style={{ width: "100%", display: "flex", gap: "8px", "& > *": { flex: 1 } } as React.CSSProperties}
                            >
                              <style>{`
                                .admin-card-actions button {
                                  flex: 1;
                                  min-height: 44px;
                                }
                              `}</style>
                              <div className="admin-card-actions" style={{ display: "flex", width: "100%", gap: "8px" }}>
                                {actionsCol.render(row)}
                              </div>
                            </div>
                          ) : undefined
                        }
                      />
                    )}
                    {safeTableProps.expandedRowRender && safeTableProps.expandedRowIds?.has(safeTableProps.keyExtractor(row)) && (
                      <div style={{ marginTop: 8, padding: 12, background: "var(--admin-bg)", borderRadius: 8 }}>
                        {safeTableProps.expandedRowRender(row)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
