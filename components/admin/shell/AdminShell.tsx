"use client";

import React, { useState, useEffect, useRef } from "react";
import { Menu, X, ChevronDown, ChevronRight } from "lucide-react";

// "parent-questions"/"parent-query-router"는 이 파일이 관여하지 않는 별도 티켓 소관
// 페이지다(app/admin/(dashboard)/page.tsx가 참조). 그 티켓의 컴포넌트 파일이 아직
// git에 없어 여기서는 타입 호환만 유지하고 네비게이션 항목은 추가하지 않는다.
export type AdminPageId = "overview" | "revenue" | "cost" | "llm-status" | "users" | "customer-requests" | "account-restore" | "inquiries" | "suggestions" | "bugs" | "beta-applications" | "manual-reporting" | "plan-change-requests" | "child-approval-requests" | "retention" | "events-overview" | "events-mission-onboarding" | "events-quiz-leaderboard" | "events-attendance-roulette" | "events-reward-fulfillments" | "trash" | "parent-questions" | "parent-query-router" | "push-test" | "acquisition-links" | "acquisition-dashboard";

type AdminMenuItem = { id: AdminPageId; label: string; badgeKey?: string };
type AdminMenuGroup = { id: string; label: string; items: AdminMenuItem[] };

export const ADMIN_MENU_GROUPS: AdminMenuGroup[] = [
  {
    id: "dashboard",
    label: "대시보드",
    items: [
      { id: "overview", label: "전체 현황" },
      { id: "revenue", label: "매출·가입자 상세" },
      { id: "cost", label: "나갈 돈 · 비용 상세" },
      { id: "llm-status", label: "LLM 사용 현황" },
    ]
  },
  {
    id: "users",
    label: "사용자 관리",
    items: [
      { id: "users", label: "사용자 관리" },
    ]
  },
  {
    id: "support",
    label: "고객 접수",
    items: [
      { id: "customer-requests", label: "고객 접수" },
    ]
  },
  {
    id: "reporting",
    label: "리포팅·분석",
    items: [
      { id: "manual-reporting", label: "리포팅 수동 실행" },
      { id: "retention", label: "사용자 리텐션" },
    ]
  },
  {
    id: "events",
    label: "이벤트·보상",
    items: [
      { id: "events-overview", label: "이벤트 현황" },
      { id: "events-mission-onboarding", label: "미션 이벤트" },
      { id: "events-quiz-leaderboard", label: "퀴즈 리더보드" },
      { id: "events-attendance-roulette", label: "출석 룰렛" },
      { id: "events-reward-fulfillments", label: "상품권 지급 관리" },
    ]
  },
  {
    id: "ops",
    label: "운영 도구",
    items: [
      { id: "push-test", label: "푸시 발송 테스트" },
      { id: "acquisition-links", label: "회원가입 유입 링크 관리" },
      { id: "acquisition-dashboard", label: "회원가입 유입 현황" },
      { id: "trash", label: "휴지통" },
    ]
  }
];

export const ADMIN_NAV_ITEMS: { id: AdminPageId; label: string }[] = ADMIN_MENU_GROUPS.flatMap(group => group.items);

export interface AdminShellProps {
  children: React.ReactNode;
  activeMenuId: AdminPageId;
  onMenuChange: (id: AdminPageId) => void;
}

export function AdminShell({ children, activeMenuId, onMenuChange }: AdminShellProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [manuallyOpened, setManuallyOpened] = useState<Record<string, boolean>>({});
  const mainScrollRef = useRef<HTMLElement>(null);

  // 관리자 Shell이 viewport 스크롤을 전부 소유한다. 일반 사용자 화면에는 영향을
  // 남기지 않도록 mount 동안에만 html/body 스크롤을 잠그고 원래 값을 복원한다.
  useEffect(() => {
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    return () => {
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.body.style.overflow = originalBodyOverflow;
    };
  }, []);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("admin-menu-expanded-groups");
      if (stored) {
        setManuallyOpened(JSON.parse(stored));
      }
    } catch (e) {
      // Ignore sessionStorage parsing errors
    }
  }, []);

  // 이 화면은 URL 라우트 대신 activeMenuId로 관리자 페이지를 전환한다. 새 메뉴로
  // 이동할 때만 본문을 상단으로 되돌리고, 같은 메뉴의 필터 변경에는 관여하지 않는다.
  useEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [activeMenuId]);

  useEffect(() => {
    const selector = `[data-admin-menu-id="${activeMenuId}"]`;
    document.querySelectorAll<HTMLElement>(selector).forEach((item) => {
      item.scrollIntoView({ block: "nearest" });
    });
  }, [activeMenuId, isMobileMenuOpen]);

  const toggleGroup = (groupId: string) => {
    setManuallyOpened(prev => {
      const next = { ...prev, [groupId]: !prev[groupId] };
      try {
        sessionStorage.setItem("admin-menu-expanded-groups", JSON.stringify(next));
      } catch (e) {
        // Ignore errors
      }
      return next;
    });
  };

  const renderNavGroups = (isMobile: boolean) => {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--admin-space-16)" }}>
        {ADMIN_MENU_GROUPS.map(group => {
          if (group.items.length === 0) return null;

          const groupContainsActive = group.items.some(item => item.id === activeMenuId);
          const isOpen = (manuallyOpened[group.id] ?? false) || groupContainsActive;

          return (
            <div key={group.id} style={{ display: "flex", flexDirection: "column", gap: "var(--admin-space-4)" }}>
              <button
                onClick={() => toggleGroup(group.id)}
                aria-expanded={isOpen}
                aria-controls={`group-${group.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "var(--admin-space-8) var(--admin-space-16)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--admin-text-primary)",
                  fontWeight: 700,
                  fontSize: "var(--admin-text-body)",
                }}
                className="admin-sidebar-group-btn"
              >
                <span>{group.label}</span>
                {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </button>

              {isOpen && (
                <div id={`group-${group.id}`} style={{ display: "flex", flexDirection: "column", gap: "var(--admin-space-2)" }}>
                  {group.items.map(item => (
                    <button
                      key={item.id}
                      data-admin-menu-id={item.id}
                      onClick={() => {
                        if (item.id === "users" && window.location.pathname !== "/admin/users") {
                          window.location.assign("/admin/users");
                        } else if (item.id === "customer-requests" && window.location.pathname !== "/admin/customer-requests") {
                          window.location.assign("/admin/customer-requests");
                        } else {
                          onMenuChange(item.id);
                        }
                        if (isMobile) {
                          setIsMobileMenuOpen(false);
                        }
                      }}
                      style={{
                        textAlign: "left",
                        padding: "0 var(--admin-space-16)",
                        paddingLeft: "calc(var(--admin-space-16) + var(--admin-space-12))", // 들여쓰기
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
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className="admin-shell-root"
      style={{
        height: "100dvh",
        background: "var(--admin-bg)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
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
          flexShrink: 0,
          position: "relative",
          zIndex: 40,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--admin-space-16)" }}>
          {/* Mobile menu toggle */}
          <button
            className="flex lg:hidden"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="메뉴 열기"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "var(--admin-space-8)",
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
      <div
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          display: "flex",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Sidebar Desktop */}
        <aside
          className="hidden lg:flex admin-sidebar-scrollable"
          tabIndex={0}
          aria-label="관리자 메뉴"
          style={{
            width: "232px",
            background: "var(--admin-surface)",
            borderRight: "1px solid var(--admin-border)",
            flexDirection: "column",
            padding: "var(--admin-space-24) 0", // 좌우 패딩을 줄이고 내부 요소에서 처리
            flexShrink: 0,
            height: "100%",
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
            overscrollBehavior: "contain",
          }}
        >
          {renderNavGroups(false)}
        </aside>

        {/* Sidebar Mobile Drawer */}
        {isMobileMenuOpen && (
          <div
            className="flex lg:hidden"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 50,
            }}
          >
            <div
              style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }}
              onClick={() => setIsMobileMenuOpen(false)}
            />
            <aside
              role="dialog"
              aria-modal="true"
              aria-label="관리자 메뉴"
              tabIndex={0}
              style={{
                position: "relative",
                width: "232px",
                background: "var(--admin-surface)",
                display: "flex",
                flexDirection: "column",
                padding: "var(--admin-space-24) 0",
                boxShadow: "2px 0 12px rgba(0,0,0,0.1)",
                height: "100dvh",
                minHeight: 0,
                overflowY: "auto",
                overflowX: "hidden",
                overscrollBehavior: "contain",
                WebkitOverflowScrolling: "touch",
                paddingTop: "max(var(--admin-space-24), env(safe-area-inset-top))",
                paddingBottom: "env(safe-area-inset-bottom, var(--admin-space-24))",
              }}
            >
              {renderNavGroups(true)}
            </aside>
          </div>
        )}

        {/* Content */}
        <main
          ref={mainScrollRef}
          className="admin-content"
          tabIndex={0}
          aria-label="관리자 본문"
          style={{
            flex: "1 1 auto",
            minWidth: 0, // Prevent grid blowout
            minHeight: 0,
            overflowY: isMobileMenuOpen ? "hidden" : "auto",
            overflowX: "hidden",
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {children}
        </main>
      </div>
      <style jsx>{`
        @supports not (height: 100dvh) {
          .admin-shell-root {
            height: 100vh !important;
          }
        }
      `}</style>
    </div>
  );
}
