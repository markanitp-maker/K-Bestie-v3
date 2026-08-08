"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import EventsOverviewTab from "../(dashboard)/EventsOverviewTab";
import MissionOnboardingEventsTab from "../(dashboard)/MissionOnboardingEventsTab";
import QuizLeaderboardEventsTab from "../(dashboard)/QuizLeaderboardEventsTab";
import AttendanceRouletteAdminTab from "../(dashboard)/AttendanceRouletteAdminTab";
import RewardFulfillmentsTab from "../(dashboard)/RewardFulfillmentsTab";
import { AdminShell, type AdminPageId } from "@/components/admin/shell/AdminShell";

const TABS = [
  { id: "overview", label: "개요" },
  { id: "missions", label: "미션 30일" },
  { id: "leaderboard", label: "퀴즈 리더보드" },
  { id: "attendance", label: "출석 룰렛" },
  { id: "fulfillments", label: "지급 관리" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTabId(value: string | null): value is TabId {
  return TABS.some((tab) => tab.id === value);
}

function EventsRewardsConsole() {
  const router = useRouter();
  const rawSearchParams = useSearchParams();
  const searchParams = rawSearchParams ?? new URLSearchParams();
  const tab = isTabId(searchParams.get("tab")) ? searchParams.get("tab") : "overview";
  const [search, setSearch] = useState("");
  const [includeTestAccounts, setIncludeTestAccounts] = useState(false);
  const initialStatus = searchParams.get("status") ?? "all";

  const activeTab = useMemo(() => TABS.find((item) => item.id === tab) ?? TABS[0], [tab]);

  const changeTab = (nextTab: TabId) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", nextTab);
    if (nextTab !== "fulfillments") params.delete("status");
    router.replace(`/admin/events-rewards?${params.toString()}`, { scroll: false });
  };

  const handleMenuChange = (menu: AdminPageId) => {
    if (menu === "events-rewards") return;
    window.location.assign(`/admin?menu=${encodeURIComponent(menu)}`);
  };

  return (
    <AdminShell activeMenuId="events-rewards" onMenuChange={handleMenuChange}>
      <div style={{ padding: "clamp(16px, 3vw, 28px)", minWidth: 0 }}>
        <header style={{ marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: "clamp(22px, 3vw, 30px)", fontWeight: 850, color: "var(--admin-text-primary)" }}>이벤트·보상</h1>
          <p style={{ margin: "6px 0 0", color: "var(--admin-text-secondary)", fontSize: 13 }}>참여부터 오프라인 상품 전달 기록까지 한 화면에서 확인합니다.</p>
        </header>

        <nav aria-label="이벤트·보상 탭" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 14 }}>
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={activeTab.id === item.id ? "page" : undefined}
              onClick={() => changeTab(item.id)}
              style={{
                flex: "0 0 auto",
                minHeight: 42,
                padding: "9px 14px",
                borderRadius: 10,
                border: activeTab.id === item.id ? "1px solid var(--admin-primary)" : "1px solid var(--admin-border)",
                background: activeTab.id === item.id ? "var(--admin-primary)" : "var(--admin-surface)",
                color: activeTab.id === item.id ? "white" : "var(--admin-text-secondary)",
                fontWeight: 750,
                cursor: "pointer",
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: 12, marginBottom: 18, border: "1px solid var(--admin-border)", borderRadius: 12, background: "var(--admin-surface)" }}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="아이 이름 또는 로그인 ID 검색"
            aria-label="아이 이름 또는 로그인 ID 검색"
            style={{ flex: "1 1 260px", minWidth: 0, padding: "9px 12px", border: "1px solid var(--admin-border)", borderRadius: 8 }}
          />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            <input type="checkbox" checked={includeTestAccounts} onChange={(event) => setIncludeTestAccounts(event.target.checked)} />
            내부 테스트 계정 포함
          </label>
        </div>

        {tab === "overview" && <EventsOverviewTab includeTestAccounts={includeTestAccounts} externalSearch={search} />}
        {tab === "missions" && <MissionOnboardingEventsTab includeTestAccounts={includeTestAccounts} externalSearch={search} />}
        {tab === "leaderboard" && <QuizLeaderboardEventsTab includeTestAccounts={includeTestAccounts} externalSearch={search} />}
        {tab === "attendance" && <AttendanceRouletteAdminTab externalIncludeTestAccounts={includeTestAccounts} externalSearch={search} />}
        {tab === "fulfillments" && <RewardFulfillmentsTab includeTestAccounts={includeTestAccounts} externalSearch={search} initialStatus={initialStatus} />}
      </div>
    </AdminShell>
  );
}

export default function EventsRewardsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>이벤트·보상 화면을 불러오는 중입니다…</div>}>
      <EventsRewardsConsole />
    </Suspense>
  );
}
