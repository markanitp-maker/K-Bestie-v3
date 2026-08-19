"use client";

import { Component, Suspense, useMemo, type ErrorInfo, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PushTestTab from "../(dashboard)/PushTestTab";
import AcquisitionDashboardTab from "../(dashboard)/AcquisitionDashboardTab";
import AcquisitionLinksTab from "../(dashboard)/AcquisitionLinksTab";
import TrashTab from "../(dashboard)/TrashTab";
import IssuesTab from "../(dashboard)/IssuesTab";
import { AdminShell, type AdminPageId } from "@/components/admin/shell/AdminShell";
import { buildOperationsHref, parseOperationsLocation, type AcquisitionSharedState, type AcquisitionSubTab, type OperationsTab } from "@/lib/admin/operationsConsole";

const TABS: Array<{ id: OperationsTab; label: string }> = [
  { id: "push", label: "푸시 테스트" },
  { id: "acquisition", label: "회원가입 유입" },
  { id: "trash", label: "휴지통" },
  { id: "issues", label: "이슈 사항" },
];

const SUB_TABS: Array<{ id: AcquisitionSubTab; label: string }> = [
  { id: "dashboard", label: "유입 현황" },
  { id: "links", label: "유입 링크 관리" },
];

class TabBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) {}
  componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  render() {
    if (this.state.failed) return <div role="alert" style={{ padding: 32, textAlign: "center", color: "var(--admin-danger)", border: "1px solid var(--admin-border)", borderRadius: 12, background: "var(--admin-surface)" }}>이 탭을 표시하지 못했습니다. 다른 탭으로 이동한 뒤 다시 시도해 주세요.</div>;
    return this.props.children;
  }
}

function OperationsConsole() {
  const router = useRouter();
  const rawSearchParams = useSearchParams();
  const location = useMemo(() => parseOperationsLocation(new URLSearchParams(rawSearchParams?.toString() ?? "")), [rawSearchParams]);

  const navigate = (patch: Partial<typeof location> & { acquisition?: AcquisitionSharedState }) => {
    router.replace(buildOperationsHref({ ...location, ...patch }), { scroll: false });
  };

  const handleMenuChange = (menu: AdminPageId) => {
    if (menu === "operations") return;
    if (menu === "users") router.push("/admin/users");
    else if (menu === "customer-requests") router.push("/admin/customer-requests");
    else if (menu === "analytics") router.push("/admin/analytics");
    else if (menu === "events-rewards") router.push("/admin/events-rewards");
    else router.push(`/admin?menu=${encodeURIComponent(menu)}`);
  };

  const changeTab = (tab: OperationsTab) => navigate({ tab });
  const changeSubTab = (sub: AcquisitionSubTab) => navigate({ tab: "acquisition", sub });
  const changeAcquisitionState = (acquisition: AcquisitionSharedState) => navigate({ tab: "acquisition", acquisition });
  const drillDown = (channel: string) => navigate({ tab: "acquisition", sub: "links", acquisition: { ...location.acquisition, channelFilter: channel } });

  return (
    <AdminShell activeMenuId="operations" onMenuChange={handleMenuChange}>
      <div style={{ padding: "clamp(16px, 3vw, 28px)", minWidth: 0 }}>
        <header style={{ marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: "clamp(22px, 3vw, 30px)", fontWeight: 850, color: "var(--admin-text-primary)" }}>운영 도구</h1>
          <p style={{ margin: "6px 0 0", color: "var(--admin-text-secondary)", fontSize: 13 }}>푸시 테스트, 회원가입 유입, 휴지통을 한 화면에서 관리합니다.</p>
        </header>

        <nav aria-label="운영 도구 탭" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 16 }}>
          {TABS.map((item) => <button key={item.id} type="button" aria-current={location.tab === item.id ? "page" : undefined} onClick={() => changeTab(item.id)} style={{ flex: "0 0 auto", minHeight: 42, padding: "9px 14px", borderRadius: 10, border: location.tab === item.id ? "1px solid var(--admin-primary)" : "1px solid var(--admin-border)", background: location.tab === item.id ? "var(--admin-primary)" : "var(--admin-surface)", color: location.tab === item.id ? "white" : "var(--admin-text-secondary)", fontWeight: 750, cursor: "pointer" }}>{item.label}</button>)}
        </nav>

        {location.tab === "acquisition" && <nav aria-label="회원가입 유입 하위 탭" style={{ display: "flex", gap: 8, overflowX: "auto", padding: 10, marginBottom: 18, border: "1px solid var(--admin-border)", borderRadius: 12, background: "var(--admin-surface)" }}>
          {SUB_TABS.map((item) => <button key={item.id} type="button" aria-current={location.sub === item.id ? "page" : undefined} onClick={() => changeSubTab(item.id)} style={{ flex: "0 0 auto", padding: "8px 13px", borderRadius: 9, border: location.sub === item.id ? "1px solid var(--admin-primary)" : "1px solid transparent", background: location.sub === item.id ? "var(--admin-focus)" : "transparent", color: location.sub === item.id ? "var(--admin-primary)" : "var(--admin-text-secondary)", fontWeight: 700, cursor: "pointer" }}>{item.label}</button>)}
        </nav>}

        <TabBoundary resetKey={`${location.tab}:${location.sub}`}>
          {location.tab === "push" && <PushTestTab />}
          {location.tab === "acquisition" && location.sub === "dashboard" && <AcquisitionDashboardTab sharedState={location.acquisition} onSharedStateChange={changeAcquisitionState} onChannelDrillDown={drillDown} />}
          {location.tab === "acquisition" && location.sub === "links" && <AcquisitionLinksTab channelFilter={location.acquisition.channelFilter} onChannelFilterChange={(channelFilter) => changeAcquisitionState({ ...location.acquisition, channelFilter })} />}
          {location.tab === "trash" && <TrashTab />}
          {location.tab === "issues" && <IssuesTab />}
        </TabBoundary>
      </div>
    </AdminShell>
  );
}

export default function OperationsPage() {
  return <Suspense fallback={<div style={{ padding: 24 }}>운영 도구를 불러오는 중입니다…</div>}><OperationsConsole /></Suspense>;
}
