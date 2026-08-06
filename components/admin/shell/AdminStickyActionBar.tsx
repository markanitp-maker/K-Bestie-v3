"use client";

import React from "react";

export interface AdminStickyActionBarProps {
  children: React.ReactNode;
}

export function AdminStickyActionBar({ children }: AdminStickyActionBarProps) {
  return (
    <div
      className="lg:hidden"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: "var(--admin-surface)",
        borderTop: "1px solid var(--admin-border)",
        padding: "12px 16px",
        paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
        display: "flex",
        gap: "12px",
        zIndex: 40,
        boxShadow: "0 -2px 10px rgba(0,0,0,0.05)",
      }}
    >
      {children}
    </div>
  );
}
