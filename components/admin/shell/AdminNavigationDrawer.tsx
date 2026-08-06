"use client";

import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";

export interface AdminNavigationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function AdminNavigationDrawer({ isOpen, onClose, children }: AdminNavigationDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // §4 "닫힌 뒤 햄버거 버튼으로 focus 복귀" — 열기 직전 포커스(보통 햄버거 버튼)를 기억해뒀다가 닫힐 때 되돌린다.
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const getFocusable = () =>
      Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      // §4 focus trap — Drawer 안에서만 Tab이 순환하고 배경 콘텐츠로 빠져나가지 않는다.
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    // Body scroll lock
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = "hidden";

    const focusable = getFocusable();
    if (focusable.length > 0) {
      focusable[0].focus();
    }

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalStyle;
      previouslyFocusedRef.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="md:hidden"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
      }}
    >
      <div
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={drawerRef}
        id="admin-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="관리자 내비게이션 메뉴"
        style={{
          position: "relative",
          width: "min(84vw, 320px)",
          height: "100dvh",
          background: "var(--admin-surface)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "2px 0 12px rgba(0,0,0,0.1)",
          overflowY: "auto",
        }}
      >
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--admin-space-16)",
          borderBottom: "1px solid var(--admin-border)"
        }}>
          <h2 style={{ margin: 0, fontSize: "var(--admin-text-section-title)", fontWeight: "var(--admin-weight-section-title)", color: "var(--admin-text-primary)" }}>
            관리자 메뉴
          </h2>
          <button
            onClick={onClose}
            aria-label="메뉴 닫기"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "var(--admin-space-8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--admin-text-secondary)",
              minWidth: "44px",
              minHeight: "44px"
            }}
          >
            <X size={24} />
          </button>
        </div>
        <div style={{ padding: "var(--admin-space-16)", display: "flex", flexDirection: "column", gap: "var(--admin-space-16)" }}>
          {children}
        </div>
      </aside>
    </div>
  );
}
