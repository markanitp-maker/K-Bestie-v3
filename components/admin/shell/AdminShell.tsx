"use client";

import React, { useState } from "react";
import { Menu, X } from "lucide-react";

// "parent-questions"/"parent-query-router"는 이 파일이 관여하지 않는 별도 티켓 소관
// 페이지다(app/admin/(dashboard)/page.tsx가 참조). 그 티켓의 컴포넌트 파일이 아직
// git에 없어 여기서는 타입 호환성만 유지하고 네비게이션 항목은 추가하지 않는다.
export type AdminPageId = "overview" | "revenue" | "cost" | "llm-status" | "account-restore" | "inquiries" | "suggestions" | "bugs" | "beta-applications" | "manual-reporting" | "plan-change-requests" | "child-approval-requests" | "retention" | "events-overview" | "events-mission-onboarding" | "events-quiz-leaderboard" | "events-reward-fulfillments" | "trash" | "parent-questions" | "parent-query-router" | "push-test" | "acquisition-links";

export const ADMIN_NAV_ITEMS: { id: AdminPageId; label: string }[] = [
  { id: "overview", label: "전체 현황" },
  { id: "revenue", label: "매출·가입자 상세" },
  { id: "cost", label: "나갈 돈 · 비용 상세" },
  { id: "llm-status", label: "LLM 사용 현황" },
  { id: "account-restore", label: "계정 복구 승인" },
  { id: "inquiries", label: "문의 접수" },
  { id: "suggestions", label: "건의 접수" },
  { id: "bugs", label: "버그 접수" },
  { id: "beta-applications", label: "베타 신청 관리" },
  { id: "manual-reporting", label: "리포팅 수동 실행" },
  { id: "plan-change-requests", label: "요금제 변경 요청" },
  { id: "child-approval-requests", label: "아이 승인 요청" },
  { id: "retention", label: "사용자 리텐션" },
  { id: "events-overview", label: "이벤트 현황" },
  { id: "events-mission-onboarding", label: "미션 이벤트" },
  { id: "events-quiz-leaderboard", label: "퀴즈 리더보드" },
  { id: "events-reward-fulfillments", label: "상품권 지급 관리" },
  // requests/066 — 삭제된 운영 요청 데이터 복구(30일). 계정·대화·미션·리포트는 대상 아님.
  { id: "trash", label: "휴지통" },
  { id: "push-test", label: "푸시 발송 테스트" },
  { id: "acquisition-links", label: "회원가입 유입 링크 관리" },
];

export interface AdminShellProps {
  children: React.ReactNode;
  activeMenuId: AdminPageId;
  onMenuChange: (id: AdminPageId) => void;
}

export function AdminShell({ children, activeMenuId, onMenuChange }: AdminShellProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <div style={{ minHeight: "100vh", background: "var(--admin-bg)", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header
        style={{
          height: "64px",
          background: "var(--admin-surface)",
          borderBottom: "1px solid var(--admin-border)",
          padding: "0 var(--admin-space-24)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 40,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--admin-space-16)" }}>
          {/* Mobile menu toggle */}
          <button
            className="lg:hidden"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="메뉴 열기"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "var(--admin-space-8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--admin-text-primary)",
            }}
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
          <h1 style={{
            fontSize: "var(--admin-text-section-title)",
            fontWeight: "var(--admin-weight-section-title)",
            color: "var(--admin-text-primary)",
            margin: 0
          }}>
            내친구 케이 — 관리자
          </h1>
        </div>
      </header>

      {/* Main Grid */}
      <div style={{ flex: 1, display: "flex", position: "relative" }}>
        {/* Sidebar Desktop */}
        <aside
          className="max-lg:hidden"
          style={{
            width: "232px",
            background: "var(--admin-surface)",
            borderRight: "1px solid var(--admin-border)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--admin-space-4)",
            padding: "var(--admin-space-24) var(--admin-space-16)",
            flexShrink: 0,
          }}
        >
          {ADMIN_NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => onMenuChange(item.id)}
              style={{
                textAlign: "left",
                padding: "0 var(--admin-space-16)",
                height: "44px",
                borderRadius: "8px",
                fontSize: "var(--admin-text-body)",
                fontWeight: activeMenuId === item.id ? 700 : 400,
                border: "none",
                background: activeMenuId === item.id ? "var(--admin-focus)" : "transparent",
                color: activeMenuId === item.id ? "var(--admin-primary)" : "var(--admin-text-secondary)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
              }}
            >
              {item.label}
            </button>
          ))}
        </aside>

        {/* Sidebar Mobile Drawer */}
        {isMobileMenuOpen && (
          <div
            className="lg:hidden"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 50,
              display: "flex",
            }}
          >
            <div
              style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }}
              onClick={() => setIsMobileMenuOpen(false)}
            />
            <aside
              style={{
                position: "relative",
                width: "232px",
                background: "var(--admin-surface)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--admin-space-4)",
                padding: "var(--admin-space-24) var(--admin-space-16)",
                boxShadow: "2px 0 12px rgba(0,0,0,0.1)",
              }}
            >
              {ADMIN_NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    onMenuChange(item.id);
                    setIsMobileMenuOpen(false);
                  }}
                  style={{
                    textAlign: "left",
                    padding: "0 var(--admin-space-16)",
                    height: "44px",
                    borderRadius: "8px",
                    fontSize: "var(--admin-text-body)",
                    fontWeight: activeMenuId === item.id ? 700 : 400,
                    border: "none",
                    background: activeMenuId === item.id ? "var(--admin-focus)" : "transparent",
                    color: activeMenuId === item.id ? "var(--admin-primary)" : "var(--admin-text-secondary)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {item.label}
                </button>
              ))}
            </aside>
          </div>
        )}

        {/* Content */}
        <main
          className="admin-content"
          style={{
            flex: 1,
            minWidth: 0, // Prevent grid blowout
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
