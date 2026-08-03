"use client";

import React from "react";

export interface AdminFilterBarProps {
  searchNode?: React.ReactNode;
  filterNodes?: React.ReactNode[];
}

export function AdminFilterBar({ searchNode, filterNodes }: AdminFilterBarProps) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "var(--admin-space-16)",
        alignItems: "center",
        marginBottom: "var(--admin-space-24)",
        width: "100%",
      }}
    >
      {searchNode && (
        <div style={{ flex: "1 1 240px", minWidth: 240 }}>
          {searchNode}
        </div>
      )}
      {filterNodes && filterNodes.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--admin-space-8)", alignItems: "center" }}>
          {filterNodes.map((node, index) => (
            <React.Fragment key={index}>{node}</React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
