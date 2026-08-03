"use client";

import React from "react";

export interface AdminEmptyStateProps {
  message?: string;
  description?: string;
}

export function AdminEmptyState({ message = "현재 표시할 항목이 없습니다.", description }: AdminEmptyStateProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--admin-space-48) var(--admin-space-24)",
        textAlign: "center",
        background: "var(--admin-surface)",
        borderRadius: "8px",
        border: "1px dashed var(--admin-border)",
      }}
    >
      <div style={{ fontSize: "var(--admin-text-body)", fontWeight: 500, color: "var(--admin-text-secondary)" }}>
        {message}
      </div>
      {description && (
        <div style={{ fontSize: "var(--admin-text-sm)", color: "var(--admin-text-secondary)", marginTop: "var(--admin-space-8)" }}>
          {description}
        </div>
      )}
    </div>
  );
}
