"use client";

import React from "react";

export interface AdminKpiCardProps {
  title: string;
  value: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
}

export function AdminKpiCard({ title, value, description, icon }: AdminKpiCardProps) {
  return (
    <div
      style={{
        background: "var(--admin-surface)",
        border: "1px solid var(--admin-border)",
        borderRadius: "16px",
        padding: "var(--admin-space-16)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h3 style={{
          fontSize: "var(--admin-text-card-title)",
          fontWeight: "var(--admin-weight-card-title)",
          color: "var(--admin-text-secondary)",
          margin: 0
        }}>
          {title}
        </h3>
        {icon && <div style={{ color: "var(--admin-text-secondary)" }}>{icon}</div>}
      </div>
      <div>
        <div 
          className="admin-kpi-value"
          style={{
            fontWeight: "var(--admin-weight-kpi)",
            color: "var(--admin-text-primary)",
            marginTop: "var(--admin-space-12)",
            marginBottom: description ? "var(--admin-space-4)" : 0
          }}
        >
          {value}
        </div>
        {description && (
          <div style={{ fontSize: "var(--admin-text-sm)", color: "var(--admin-text-secondary)" }}>
            {description}
          </div>
        )}
      </div>
      <style>{`
        .admin-kpi-value {
          font-size: var(--admin-text-kpi);
        }
        @media (max-width: 767px) {
          .admin-kpi-value {
            font-size: 26px; /* 26~32px */
          }
        }
      `}</style>
    </div>
  );
}

export function AdminKpiGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-kpi-grid">
      {children}
      <style>{`
        .admin-kpi-grid {
          display: grid;
          gap: var(--admin-space-16);
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
        @media (max-width: 1439px) {
          .admin-kpi-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        @media (max-width: 1023px) {
          .admin-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 767px) {
          .admin-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 479px) {
          .admin-kpi-grid {
            grid-template-columns: repeat(1, minmax(0, 1fr));
          }
        }
      `}</style>
    </div>
  );
}
