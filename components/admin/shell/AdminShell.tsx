"use client";

import React, { useState } from "react";
import { AdminMobileHeader } from "./AdminMobileHeader";
import { AdminNavigationDrawer } from "./AdminNavigationDrawer";
import { AdminMenuGroup } from "./AdminMenuGroup";

export type AdminPageId = "overview" | "revenue" | "cost" | "llm-status" | "account-restore" | "feedback" | "beta-applications" | "manual-reporting" | "plan-change-requests" | "child-approval-requests" | "retention" | "events-overview" | "events-mission-onboarding" | "events-quiz-leaderboard" | "events-reward-fulfillments" | "parent-questions" | "parent-query-router" | "trash";

interface NavItem {
  id: AdminPageId;
  label: string;
}

export const ADMIN_NAV_GROUPS: { groupName: string; items: NavItem[] }[] = [
  {
    groupName: "현황·분석",
    items: [
      { id: "overview", label: "전체 현황" },
      { id: "revenue", label: "매출·가입자 상세" },
      { id: "cost", label: "나갈 돈 · 비용 상세" },
      { id: "retention", label: "사용자 리텐션" },
      { id: "llm-status", label: "LLM 사용 현황" },
    ]
  },
  {
    groupName: "승인·요청",
    items: [
      { id: "account-restore", label: "계정 복구 승인" },
      { id: "beta-applications", label: "베타 신청 관리" },
      { id: "plan-change-requests", label: "요금제 변경 요청" },
      { id: "child-approval-requests", label: "아이 승인 요청" },
    ]
  },
  {
    groupName: "운영",
    items: [
      { id: "feedback", label: "문의·건의·버그 접수" },
      { id: "manual-reporting", label: "리포팅 수동 실행" },
      { id: "events-overview", label: "이벤트 현황" },
      { id: "events-mission-onboarding", label: "미션 이벤트" },
      { id: "events-quiz-leaderboard", label: "퀴즈 리더보드" },
      { id: "events-reward-fulfillments", label: "상품권 지급 관리" },
      { id: "parent-questions", label: "부모 질문하기 조회" },
      { id: "parent-query-router", label: "부모 질문 라우터(4학년)" },
      // requests/066 — 삭제된 운영 요청 데이터 복구(30일). 계정·대화·미션·리포트는 대상 아님.
      { id: "trash", label: "휴지통" },
    ]
  }
];

export const ADMIN_NAV_ITEMS: NavItem[] = ADMIN_NAV_GROUPS.flatMap(g => g.items);

export interface AdminShellProps {
  children: React.ReactNode;
  activeMenuId: AdminPageId;
  onMenuChange: (id: AdminPageId) => void;
}

export function AdminShell({ children, activeMenuId, onMenuChange }: AdminShellProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // §2 "Tablet은 접이식 사이드바" — Desktop(lg, 1024px)뿐 아니라 Tablet(md, 768px)부터
  // 이미 docked 사이드바를 보여주되, 폭이 좁은 태블릿에서 콘텐츠 영역을 넓게 쓸 수 있게
  // 접어서(라벨 숨기고 좁은 바만) 보여줄 수 있는 토글을 추가한다.
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const activeItem = ADMIN_NAV_ITEMS.find((item) => item.id === activeMenuId);

  const renderNavItems = (collapsed = false) => (
    <>
      {ADMIN_NAV_GROUPS.map((group) => {
        // Only expand the group if it contains the active menu id, otherwise default to true (or true for all as specified: "현재 메뉴가 속한 그룹은 기본 펼침 상태로 한다. (다 펼침일 수도 있음)")
        // The spec: "현재 메뉴가 속한 그룹은 기본 펼침 상태로 한다." Let's default to true for all to mimic previous flat list but grouped.
        const isActiveGroup = group.items.some(item => item.id === activeMenuId);

        const buttons = group.items.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              onMenuChange(item.id);
              setIsMobileMenuOpen(false);
            }}
            aria-current={activeMenuId === item.id ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            aria-label={collapsed ? item.label : undefined}
            style={{
              textAlign: "left",
              padding: collapsed ? 0 : "0 var(--admin-space-16)",
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
              justifyContent: collapsed ? "center" : "flex-start",
              position: "relative",
            }}
          >
            {activeMenuId === item.id && (
              <div style={{
                position: "absolute",
                left: 0,
                top: "8px",
                bottom: "8px",
                width: "4px",
                background: "var(--admin-primary)",
                borderRadius: "0 4px 4px 0",
              }} />
            )}
            {collapsed ? item.label.slice(0, 1) : item.label}
          </button>
        ));

        if (collapsed) {
          // 접힌 상태에서는 56px 폭 바에 그룹 헤더가 들어갈 자리가 없어 버튼만 나열한다.
          return <React.Fragment key={group.groupName}>{buttons}</React.Fragment>;
        }

        return (
          <AdminMenuGroup key={group.groupName} label={group.groupName} defaultExpanded={isActiveGroup || true}>
            {buttons}
          </AdminMenuGroup>
        );
      })}
    </>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--admin-bg)", display: "flex", flexDirection: "column" }}>
      {/* Desktop Header */}
      <header
        className="hidden md:flex"
        style={{
          height: "64px",
          background: "var(--admin-surface)",
          borderBottom: "1px solid var(--admin-border)",
          padding: "0 var(--admin-space-24)",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 40,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--admin-space-16)" }}>
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

      {/* Mobile Header */}
      <AdminMobileHeader
        title={activeItem?.label || "관리자"}
        onMenuClick={() => setIsMobileMenuOpen(true)}
        isMenuOpen={isMobileMenuOpen}
      />

      {/* Main Grid */}
      <div style={{ flex: 1, display: "flex", position: "relative" }}>
        {/* Sidebar Desktop + Tablet(md, 768px 이상은 docked, 그 아래는 모바일 drawer) —
            §2 "Tablet은 접이식 사이드바": md~lg 구간에서도 사이드바가 보이되 접을 수 있다. */}
        <aside
          className="max-md:hidden"
          style={{
            width: isSidebarCollapsed ? "56px" : "232px",
            background: "var(--admin-surface)",
            borderRight: "1px solid var(--admin-border)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--admin-space-4)",
            padding: isSidebarCollapsed ? "var(--admin-space-24) var(--admin-space-8)" : "var(--admin-space-24) var(--admin-space-16)",
            flexShrink: 0,
            overflowY: "auto",
            height: "calc(100vh - 64px)",
            position: "sticky",
            top: "64px",
            transition: "width 0.2s ease",
          }}
        >
          <button
            onClick={() => setIsSidebarCollapsed((v) => !v)}
            aria-label={isSidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
            aria-expanded={!isSidebarCollapsed}
            style={{
              alignSelf: isSidebarCollapsed ? "center" : "flex-end",
              width: "32px",
              height: "32px",
              minWidth: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid var(--admin-border)",
              borderRadius: "8px",
              background: "transparent",
              color: "var(--admin-text-secondary)",
              cursor: "pointer",
              marginBottom: "var(--admin-space-8)",
            }}
          >
            {isSidebarCollapsed ? "»" : "«"}
          </button>
          {renderNavItems(isSidebarCollapsed)}
        </aside>

        {/* Sidebar Mobile Drawer (768px 미만) */}
        <AdminNavigationDrawer
          isOpen={isMobileMenuOpen}
          onClose={() => setIsMobileMenuOpen(false)}
        >
          {renderNavItems(false)}
        </AdminNavigationDrawer>

        {/* Content */}
        <main
          className="admin-content"
          style={{
            flex: 1,
            minWidth: 0,
            width: "100%", // ensure no blowout
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
