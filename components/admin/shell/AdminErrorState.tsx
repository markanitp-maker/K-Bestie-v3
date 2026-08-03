"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";

export interface AdminErrorStateProps {
  error?: string;
  onRetry?: () => void;
}

export function AdminErrorState({ error = "데이터를 불러오지 못했습니다.", onRetry }: AdminErrorStateProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--admin-space-48) var(--admin-space-24)",
        textAlign: "center",
        background: "var(--color-k-danger-bg)",
        borderRadius: "8px",
        border: "1px solid var(--admin-danger)",
        color: "var(--admin-danger)",
      }}
    >
      <AlertTriangle size={32} style={{ marginBottom: "var(--admin-space-16)" }} />
      <div style={{ fontSize: "var(--admin-text-body)", fontWeight: 600, marginBottom: "var(--admin-space-16)" }}>
        {error}
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            padding: "0 var(--admin-space-16)",
            minHeight: "44px",
            background: "var(--admin-danger)",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            fontSize: "var(--admin-text-sm)",
            fontWeight: 600,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          className="admin-retry-btn"
        >
          다시 시도
        </button>
      )}
      <style>{`
        .admin-retry-btn:hover {
          opacity: 0.9;
        }
        .admin-retry-btn:focus-visible {
          outline: 2px solid var(--admin-danger);
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
