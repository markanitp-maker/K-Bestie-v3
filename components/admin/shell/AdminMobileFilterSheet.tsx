"use client";

import React from "react";
import { X } from "lucide-react";

export interface AdminMobileFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  onApply?: () => void;
  onReset?: () => void;
}

export function AdminMobileFilterSheet({
  isOpen,
  onClose,
  title = "필터",
  children,
  onApply,
  onReset,
}: AdminMobileFilterSheetProps) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      }}
    >
      <div
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: "relative",
          background: "var(--admin-surface)",
          width: "100%",
          maxHeight: "90dvh",
          borderTopLeftRadius: "16px",
          borderTopRightRadius: "16px",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 -4px 16px rgba(0,0,0,0.1)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px",
            borderBottom: "1px solid var(--admin-border)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "var(--admin-text-primary)" }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="닫기"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--admin-text-secondary)",
              minWidth: "44px",
              minHeight: "44px",
              marginRight: "-8px",
            }}
          >
            <X size={24} />
          </button>
        </div>
        
        <div style={{ padding: "16px", overflowY: "auto", flex: 1 }}>
          {children}
        </div>

        {(onApply || onReset) && (
          <div
            style={{
              padding: "16px",
              borderTop: "1px solid var(--admin-border)",
              display: "flex",
              gap: "12px",
              paddingBottom: "calc(16px + env(safe-area-inset-bottom))",
            }}
          >
            {onReset && (
              <button
                onClick={onReset}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: "8px",
                  border: "1px solid var(--admin-border)",
                  background: "transparent",
                  color: "var(--admin-text-primary)",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                  minHeight: "44px",
                }}
              >
                초기화
              </button>
            )}
            {onApply && (
              <button
                onClick={onApply}
                style={{
                  flex: 2,
                  padding: "12px",
                  borderRadius: "8px",
                  border: "none",
                  background: "var(--admin-primary)",
                  color: "white",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                  minHeight: "44px",
                }}
              >
                적용하기
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
