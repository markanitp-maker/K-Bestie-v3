"use client";

import React from "react";

export interface AdminMobileListCardProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  status?: React.ReactNode;
  content?: React.ReactNode;
  actions?: React.ReactNode;
}

export function AdminMobileListCard({ title, subtitle, status, content, actions }: AdminMobileListCardProps) {
  return (
    <div
      style={{
        background: "var(--admin-surface)",
        borderRadius: "12px",
        border: "1px solid var(--admin-border)",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--admin-text-primary)", wordBreak: "break-word" }}>
            {title}
          </div>
          {subtitle && (
            <div style={{ fontSize: "12px", color: "var(--admin-text-secondary)", marginTop: "4px" }}>
              {subtitle}
            </div>
          )}
        </div>
        {status && (
          <div style={{ flexShrink: 0 }}>
            {status}
          </div>
        )}
      </div>
      
      {content && (
        <div style={{ fontSize: "13px", color: "var(--admin-text-primary)" }}>
          {content}
        </div>
      )}
      
      {actions && (
        <div style={{ marginTop: "4px", display: "flex", gap: "8px", width: "100%" }}>
          {actions}
        </div>
      )}
    </div>
  );
}
