"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export interface AdminMenuGroupProps {
  label: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}

export function AdminMenuGroup({ label, defaultExpanded = true, children }: AdminMenuGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div style={{ marginBottom: "var(--admin-space-8)" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "transparent",
          border: "none",
          padding: "var(--admin-space-8) var(--admin-space-16)",
          cursor: "pointer",
          color: "var(--admin-text-secondary)",
          fontSize: "var(--admin-text-sm)",
          fontWeight: 600,
        }}
      >
        <span>{label}</span>
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--admin-space-4)", marginTop: "var(--admin-space-4)" }}>
          {children}
        </div>
      )}
    </div>
  );
}
