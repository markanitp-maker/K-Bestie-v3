"use client";

import React from "react";

export interface AdminPageHeaderProps {
  title: string;
  description?: React.ReactNode;
  status?: React.ReactNode;
  action?: React.ReactNode;
}

export function AdminPageHeader({ title, description, status, action }: AdminPageHeaderProps) {
  return (
    <div style={{ marginBottom: "var(--admin-space-24)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--admin-space-16)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--admin-space-8)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--admin-space-12)" }}>
            <h1 style={{
              fontSize: "var(--admin-text-page-title)",
              fontWeight: "var(--admin-weight-page-title)",
              color: "var(--admin-text-primary)",
              margin: 0
            }}>
              {title}
            </h1>
            {status && <div>{status}</div>}
          </div>
          {description && (
            <div style={{
              fontSize: "var(--admin-text-body)",
              color: "var(--admin-text-secondary)",
              margin: 0
            }}>
              {description}
            </div>
          )}
        </div>
        {action && (
          <div style={{ flexShrink: 0 }}>
            {action}
          </div>
        )}
      </div>
    </div>
  );
}
