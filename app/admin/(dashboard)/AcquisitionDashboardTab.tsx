import React, { useState, useEffect, useCallback } from "react";
import { type AdminDataTableColumn } from "@/components/admin/shell/AdminDataTable";
import { AdminResponsiveTable } from "@/components/admin/shell/AdminResponsiveTable";
import { AdminKpiCard } from "@/components/admin/shell/AdminKpiCard";
import { AdminPageHeader } from "@/components/admin/shell/AdminPageHeader";
import { AdminFilterBar } from "@/components/admin/shell/AdminFilterBar";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { AcquisitionSharedState } from "@/lib/admin/operationsConsole";

type Period = "today" | "7d" | "14d" | "30d" | "month" | "last_month" | "all" | "custom";
const PERIOD_LABELS: Record<Period, string> = {
  today: "오늘",
  "7d": "최근 7일",
  "14d": "최근 14일",
  "30d": "최근 30일",
  month: "이번 달",
  last_month: "지난달",
  all: "전체",
  custom: "사용자 지정",
};

interface AcquisitionDashboardTabProps {
  sharedState?: AcquisitionSharedState;
  onSharedStateChange?: (next: AcquisitionSharedState) => void;
  onChannelDrillDown?: (channel: string) => void;
}

const DEFAULT_STATE: AcquisitionSharedState = {
  period: "30d",
  attribution: "signup",
  includeTestAccounts: false,
  channelFilter: "",
  startDate: "",
  endDate: "",
};

export default function AcquisitionDashboardTab({ sharedState, onSharedStateChange, onChannelDrillDown }: AcquisitionDashboardTabProps = {}) {
  const [localState, setLocalState] = useState<AcquisitionSharedState>(DEFAULT_STATE);
  const state = sharedState ?? localState;
  const { period, attribution, includeTestAccounts, channelFilter, startDate, endDate } = state;
  const updateState = (patch: Partial<AcquisitionSharedState>) => {
    const next = { ...state, ...patch };
    if (!sharedState) setLocalState(next);
    onSharedStateChange?.(next);
  };

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    let url = `/api/admin/acquisition/dashboard?period=${period}&attribution=${attribution}&includeTestAccounts=${includeTestAccounts}`;
    if (channelFilter) url += `&channel=${encodeURIComponent(channelFilter)}`;
    if (period === "custom") {
      if (startDate) url += `&startDate=${startDate}`;
      if (endDate) url += `&endDate=${endDate}`;
    }
    
    try {
      const response = await fetch(url);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "유입 현황을 불러오지 못했습니다.");
      setData(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "유입 현황을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [period, attribution, includeTestAccounts, channelFilter, startDate, endDate]);

  useEffect(() => {
    if (period === "custom" && (!startDate || !endDate)) return;
    load();
  }, [load, period, startDate, endDate]);

  const kpi = data?.kpi || {};
  const channelTable = data?.channelTable || [];
  const channelOptions = Array.from(new Set<string>(channelTable.map((row: any) => String(row.channel))));
  
  const columns: AdminDataTableColumn<any>[] = [
    { key: "channel", header: "채널", sortable: true, sortType: "text", sortValue: (r) => r.channel, render: (r) => onChannelDrillDown ? <button type="button" onClick={() => onChannelDrillDown(r.channel)} style={{ padding: 0, border: 0, background: "transparent", fontWeight: 700, color: "var(--admin-primary)", cursor: "pointer" }}>{r.channel}</button> : <a href={`/admin/retention?scope=parent&signup_source=${encodeURIComponent(r.channel)}`} style={{ fontWeight: 600, color: "var(--admin-primary)", textDecoration: "none" }}>{r.channel}</a> },
    { key: "uniqueVisitors", header: "고유 방문자", sortable: true, sortType: "number", sortValue: (r) => r.uniqueVisitors, render: (r) => r.uniqueVisitors.toLocaleString() },
    { key: "landingView", header: "랜딩 조회", sortable: true, sortType: "number", sortValue: (r) => r.landingView, render: (r) => r.landingView.toLocaleString() },
    { key: "signupStarted", header: "가입 시작", sortable: true, sortType: "number", sortValue: (r) => r.signupStarted, render: (r) => r.signupStarted.toLocaleString() },
    { key: "parentSignup", header: "부모 가입", sortable: true, sortType: "number", sortValue: (r) => r.parentSignup, render: (r) => <a href={`/admin/retention?scope=parent&signup_source=${encodeURIComponent(r.channel)}`} style={{ color: "var(--admin-primary)", textDecoration: "none" }}>{r.parentSignup.toLocaleString()}</a> },
    { key: "childAdded", header: "아이 등록", sortable: true, sortType: "number", sortValue: (r) => r.childAdded, render: (r) => r.childAdded.toLocaleString() },
    { key: "conversionRate", header: "전환율", sortable: true, sortType: "number", sortValue: (r) => r.conversionRate, render: (r) => <div style={{ color: "var(--admin-success)", fontWeight: 600 }}>{r.conversionRate.toFixed(1)}%</div> },
    { key: "firstTouchSignups", header: "First Touch 가입", sortable: true, sortType: "number", sortValue: (r) => r.firstTouchSignups, render: (r) => r.firstTouchSignups.toLocaleString() },
    { key: "signupTouchSignups", header: "Signup Touch 가입", sortable: true, sortType: "number", sortValue: (r) => r.signupTouchSignups, render: (r) => r.signupTouchSignups.toLocaleString() },
    { key: "lastSignupAt", header: "최근 가입일", sortable: true, sortType: "date", sortValue: (r) => r.lastSignupAt, render: (r) => r.lastSignupAt ? new Date(r.lastSignupAt).toLocaleString("ko-KR") : "-" },
  ];

  return (
    <div>
      <AdminPageHeader title="회원가입 유입 현황" description="채널별 방문과 부모 회원가입 전환 성과를 확인합니다." />
      
        <AdminFilterBar 
          filterNodes={[
            <div key="period-group" style={{ display: "flex", gap: 8, maxWidth: "100%", overflowX: "auto", paddingBottom: 2 }}>
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => updateState({ period: p })}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: period === p ? 700 : 400,
                    border: period === p ? "1px solid var(--admin-primary)" : "1px solid var(--admin-border)",
                    background: period === p ? "var(--admin-surface)" : "transparent",
                    color: period === p ? "var(--admin-primary)" : "var(--admin-text-secondary)",
                    cursor: "pointer",
                    whiteSpace: "nowrap"
                  }}
                >
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>,
            period === "custom" && (
              <div key="custom-date" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="date" value={startDate} onChange={e => updateState({ startDate: e.target.value })} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--admin-border)" }} />
                <span style={{color: "var(--admin-text-secondary)"}}>~</span>
                <input type="date" value={endDate} onChange={e => updateState({ endDate: e.target.value })} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--admin-border)" }} />
              </div>
            ),
            <div key="div-1" style={{ width: "1px", height: 24, background: "var(--admin-border)", margin: "0 4px" }} />,
            <div key="attr" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, color: "var(--admin-text-secondary)", whiteSpace: "nowrap" }}>Attribution:</span>
              <select value={attribution} onChange={e => updateState({ attribution: e.target.value as "signup" | "first" })} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--admin-border)" }}>
                <option value="signup">Signup Touch</option>
                <option value="first">First Touch</option>
              </select>
            </div>,
            <label key="test-acc" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--admin-text-secondary)", cursor: "pointer", whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={includeTestAccounts} onChange={e => updateState({ includeTestAccounts: e.target.checked })} />
              내부 테스트 포함
            </label>,
            <select key="channel" value={channelFilter} onChange={e => updateState({ channelFilter: e.target.value })} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--admin-border)" }} aria-label="채널 필터">
              <option value="">모든 채널</option>
              {channelOptions.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
            </select>
          ].filter(Boolean)}
        />

      {error ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--admin-danger)" }}>{error}<button type="button" onClick={load} style={{ display: "block", margin: "12px auto 0", padding: "8px 14px", borderRadius: 8, border: "1px solid var(--admin-border)", background: "var(--admin-surface)", cursor: "pointer" }}>다시 시도</button></div>
      ) : loading && !data ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--admin-text-secondary)" }}>로딩 중...</div>
      ) : data ? (
        <>
          {/* KPI Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
            <AdminKpiCard title="총 클릭 수" value={kpi.totalClicks.toLocaleString()} />
            <AdminKpiCard title="고유 방문자 수" value={kpi.uniqueVisitors.toLocaleString()} />
            <AdminKpiCard title="랜딩 조회 수" value={kpi.landingView.toLocaleString()} />
            <AdminKpiCard title="가입 시작 수" value={kpi.signupStarted.toLocaleString()} />
            <AdminKpiCard title="부모 가입 완료 수" value={kpi.parentSignup.toLocaleString()} />
            <AdminKpiCard title="가입 전환율" value={kpi.uniqueVisitors === 0 ? "-" : `${kpi.conversionRate.toFixed(1)}%`} />
            <AdminKpiCard title="아이 등록 수" value={kpi.childAdded.toLocaleString()} />
            <AdminKpiCard title="부모당 평균 아이 수" value={kpi.parentToChildRatio.toFixed(2)} />
            <AdminKpiCard title="미확인 유입 가입 수" value={kpi.unknownSignups.toLocaleString()} />
          </div>

          {/* Charts Row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 16, marginBottom: 24 }}>
            <div style={{ background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--admin-text-primary)" }}>채널별 부모 가입 수 (Signup Touch)</div>
              <div style={{ height: 260 }}>
                {data.channelSignups?.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.channelSignups} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--admin-border)" />
                      <XAxis dataKey="channel" fontSize={11} angle={-30} textAnchor="end" height={50} />
                      <YAxis fontSize={11} width={40} />
                      <Tooltip cursor={{ fill: "var(--admin-focus)" }} contentStyle={{ borderRadius: 8 }} />
                      <Bar dataKey="count" fill="var(--admin-primary)" radius={[4, 4, 0, 0]} name="가입 완료" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--admin-text-secondary)", fontSize: 13 }}>데이터 없음</div>
                )}
              </div>
            </div>

            <div style={{ background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--admin-text-primary)" }}>채널별 전환율 (%)</div>
              <div style={{ height: 260 }}>
                {data.channelConversion?.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.channelConversion} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--admin-border)" />
                      <XAxis dataKey="channel" fontSize={11} angle={-30} textAnchor="end" height={50} />
                      <YAxis fontSize={11} width={40} domain={[0, 'auto']} />
                      <Tooltip cursor={{ fill: "var(--admin-focus)" }} contentStyle={{ borderRadius: 8 }} />
                      <Bar dataKey="rate" fill="var(--admin-success)" radius={[4, 4, 0, 0]} name="전환율 (%)" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--admin-text-secondary)", fontSize: 13 }}>데이터 없음</div>
                )}
              </div>
            </div>
          </div>

          <div style={{ background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 12, padding: 16, marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--admin-text-primary)" }}>일자별 부모 가입완료 추이</div>
            <div style={{ height: 260 }}>
              {data.dailyTrend?.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.dailyTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--admin-border)" />
                    <XAxis dataKey="date" fontSize={11} tickFormatter={v => v.slice(5)} />
                    <YAxis fontSize={11} width={40} allowDecimals={false} />
                    <Tooltip contentStyle={{ borderRadius: 8 }} />
                    <Line type="monotone" dataKey="count" stroke="var(--admin-primary)" strokeWidth={2} dot={{ r: 4 }} name="가입 수" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--admin-text-secondary)", fontSize: 13 }}>데이터 없음</div>
              )}
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--admin-text-primary)" }}>채널별 성과표</div>
            <AdminResponsiveTable
              mobileStrategy="card"
              columns={columns}
              data={channelTable}
              keyExtractor={(r) => r.channel}
              emptyMessage="표시할 채널 성과가 없습니다."
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
