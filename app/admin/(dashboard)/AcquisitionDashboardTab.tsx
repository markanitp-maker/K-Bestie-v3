import React, { useState, useEffect, useCallback } from "react";
import { AdminDataTable, type AdminDataTableColumn } from "@/components/admin/shell/AdminDataTable";
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

export default function AcquisitionDashboardTab() {
  const [period, setPeriod] = useState<Period>("30d");
  const [attribution, setAttribution] = useState<"signup" | "first">("signup");
  const [includeTestAccounts, setIncludeTestAccounts] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    let url = `/api/admin/acquisition/dashboard?period=${period}&attribution=${attribution}&includeTestAccounts=${includeTestAccounts}`;
    if (period === "custom") {
      if (startDate) url += `&startDate=${startDate}`;
      if (endDate) url += `&endDate=${endDate}`;
    }
    
    fetch(url)
      .then(r => r.json())
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [period, attribution, includeTestAccounts, startDate, endDate]);

  useEffect(() => {
    if (period === "custom" && (!startDate || !endDate)) return;
    load();
  }, [load, period, startDate, endDate]);

  const kpi = data?.kpi || {};
  const channelTable = data?.channelTable || [];
  
  const columns: AdminDataTableColumn<any>[] = [
    { key: "channel", header: "채널", render: (r) => <a href={`/admin/retention?scope=parent&signup_source=${encodeURIComponent(r.channel)}`} style={{ fontWeight: 600, color: "var(--admin-primary)", textDecoration: "none" }}>{r.channel}</a> },
    { key: "uniqueVisitors", header: "고유 방문자", render: (r) => r.uniqueVisitors.toLocaleString() },
    { key: "signupStarted", header: "가입 시작", render: (r) => r.signupStarted.toLocaleString() },
    { key: "parentSignup", header: "부모 가입", render: (r) => <a href={`/admin/retention?scope=parent&signup_source=${encodeURIComponent(r.channel)}`} style={{ color: "var(--admin-primary)", textDecoration: "none" }}>{r.parentSignup.toLocaleString()}</a> },
    { key: "childAdded", header: "아이 등록", render: (r) => r.childAdded.toLocaleString() },
    { key: "conversionRate", header: "전환율", render: (r) => <div style={{ color: "var(--admin-success)", fontWeight: 600 }}>{r.conversionRate.toFixed(1)}%</div> },
    { key: "firstTouchSignups", header: "First Touch 가입", render: (r) => r.firstTouchSignups.toLocaleString() },
    { key: "signupTouchSignups", header: "Signup Touch 가입", render: (r) => r.signupTouchSignups.toLocaleString() },
    { key: "lastSignupAt", header: "최근 가입일", render: (r) => r.lastSignupAt ? new Date(r.lastSignupAt).toLocaleString("ko-KR") : "-" },
  ];

  return (
    <div>
      <AdminPageHeader title="회원가입 유입 현황" description="채널별 방문과 부모 회원가입 전환 성과를 확인합니다." />
      
        <AdminFilterBar 
          filterNodes={[
            <div key="period-group" style={{ display: "flex", gap: 8 }}>
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
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
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--admin-border)" }} />
                <span style={{color: "var(--admin-text-secondary)"}}>~</span>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--admin-border)" }} />
              </div>
            ),
            <div key="div-1" style={{ width: "1px", height: 24, background: "var(--admin-border)", margin: "0 4px" }} />,
            <div key="attr" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, color: "var(--admin-text-secondary)", whiteSpace: "nowrap" }}>Attribution:</span>
              <select value={attribution} onChange={e => setAttribution(e.target.value as "signup" | "first")} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--admin-border)" }}>
                <option value="signup">Signup Touch</option>
                <option value="first">First Touch</option>
              </select>
            </div>,
            <label key="test-acc" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--admin-text-secondary)", cursor: "pointer", whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={includeTestAccounts} onChange={e => setIncludeTestAccounts(e.target.checked)} />
              내부 테스트 포함
            </label>
          ].filter(Boolean)}
        />

      {loading && !data ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--admin-text-secondary)" }}>로딩 중...</div>
      ) : data ? (
        <>
          {/* KPI Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
            <AdminKpiCard title="총 클릭 수" value={kpi.totalClicks.toLocaleString()} />
            <AdminKpiCard title="고유 방문자 수" value={kpi.uniqueVisitors.toLocaleString()} />
            <AdminKpiCard title="가입 시작 수" value={kpi.signupStarted.toLocaleString()} />
            <AdminKpiCard title="부모 가입 완료 수" value={kpi.parentSignup.toLocaleString()} />
            <AdminKpiCard title="가입 전환율" value={kpi.uniqueVisitors === 0 ? "-" : `${kpi.conversionRate.toFixed(1)}%`} />
            <AdminKpiCard title="아이 등록 수" value={kpi.childAdded.toLocaleString()} />
            <AdminKpiCard title="부모당 평균 아이 수" value={kpi.parentToChildRatio.toFixed(2)} />
            <AdminKpiCard title="미확인 유입 가입 수" value={kpi.unknownSignups.toLocaleString()} />
          </div>

          {/* Charts Row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
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
            <AdminDataTable
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
