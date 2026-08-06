"use client";

import React, { useState } from "react";
import { Filter } from "lucide-react";
import { AdminMobileFilterSheet } from "./AdminMobileFilterSheet";

export interface AdminFilterBarProps {
  searchNode?: React.ReactNode;
  filterNodes?: React.ReactNode[];
  mobileFilterSheetNodes?: React.ReactNode[]; // If provided, shows a filter button on mobile that opens a sheet
}

export function AdminFilterBar({ searchNode, filterNodes, mobileFilterSheetNodes }: AdminFilterBarProps) {
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  return (
    <>
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
        
        {/* On mobile, we might want to allow horizontal scrolling for inline filters */}
        {filterNodes && filterNodes.length > 0 && (
          <div 
            style={{ 
              display: "flex", 
              gap: "var(--admin-space-8)", 
              alignItems: "center",
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
              scrollbarWidth: "none", // hide scrollbar Firefox
              msOverflowStyle: "none", // hide scrollbar IE/Edge
              flexWrap: "nowrap",
            }}
          >
            {filterNodes.map((node, index) => (
              <div key={index} style={{ flexShrink: 0 }}>
                {node}
              </div>
            ))}
            
            {mobileFilterSheetNodes && mobileFilterSheetNodes.length > 0 && (
              <button
                className="lg:hidden"
                onClick={() => setIsSheetOpen(true)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "999px",
                  border: "1px solid var(--admin-border)",
                  background: "var(--admin-surface)",
                  color: "var(--admin-text-primary)",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  flexShrink: 0,
                  height: "32px",
                }}
              >
                <Filter size={14} />
                <span>필터</span>
              </button>
            )}
          </div>
        )}
      </div>

      {mobileFilterSheetNodes && mobileFilterSheetNodes.length > 0 && (
        <AdminMobileFilterSheet
          isOpen={isSheetOpen}
          onClose={() => setIsSheetOpen(false)}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {mobileFilterSheetNodes.map((node, i) => (
              <div key={i}>{node}</div>
            ))}
          </div>
        </AdminMobileFilterSheet>
      )}
    </>
  );
}
