"use client";

import React from "react";
import { Menu } from "lucide-react";

export interface AdminMobileHeaderProps {
  title: string;
  onMenuClick: () => void;
  action?: React.ReactNode;
  isMenuOpen?: boolean;
}

export function AdminMobileHeader({ title, onMenuClick, action, isMenuOpen = false }: AdminMobileHeaderProps) {
  return (
    <header
      className="md:hidden"
      style={{
        height: "56px",
        background: "var(--admin-surface)",
        borderBottom: "1px solid var(--admin-border)",
        padding: "0 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 40,
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--admin-space-8)" }}>
        <button
          onClick={onMenuClick}
          aria-label="메뉴 열기"
          aria-expanded={isMenuOpen}
          aria-controls="admin-drawer"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--admin-text-primary)",
            minWidth: "44px",
            minHeight: "44px",
            marginLeft: "-8px",
          }}
        >
          <Menu size={24} />
        </button>
        <h1 style={{
          fontSize: "16px",
          fontWeight: 700,
          color: "var(--admin-text-primary)",
          margin: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {title}
        </h1>
      </div>
      {action && (
        <div style={{ display: "flex", alignItems: "center" }}>
          {action}
        </div>
      )}
    </header>
  );
}
