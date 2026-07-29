"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, BarChart, Bar, Legend } from "recharts";

type Period = "7d" | "14d" | "30d" | "month" | "all";

function pct(num: number | null): string {
  if (num === null) return "대상 없음";
  return `${(num * 100).toFixed(1)}%`;
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}초`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}분 ${s}초`;
}

function MetricCard({ label, value, sub, deltaPct, actualString }: { label: string; value: string; sub?: string; deltaPct?: number | null; actualString?: string }) {
  return (
    <div style={{ background: "var(--color-k-background)", borderRadius: 14, boxShadow: "var(--shadow-k-card)", padding: "18px 22px", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 13, color: "var(--color-k-text-secondary)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: "clamp(20px, 2.5vw, 32px)", fontWeight: 800, color: "var(--color-k-text-primary)" }}>
        {value}
        {deltaPct !== undefined && deltaPct !== null && (
          <span style={{ fontSize: 14, marginLeft: 8, color: deltaPct > 0 ? "var(--color-k-navy)" : deltaPct < 0 ? "var(--color-k-danger)" : "var(--color-k-text-secondary)" }}>
            {deltaPct > 0 ? "▲" : deltaPct < 0 ? "▼" : "-"}{Math.abs(deltaPct)}%
          </span>
        )}
      </div>
      {actualString && <div style={{ fontSize: 12, color: "var(--color-k-text-secondary)", fontWeight: 500 }}>{actualString}</div>}
      {sub && <div style={{ fontSize: 11, color: "var(--color-k-text-secondary)" }}>{sub}</div>}
    </div>
  );
}

const thStyle = { padding: "12px 16px", fontSize: 13, color: "var(--color-k-text-secondary)", borderBottom: "1px solid var(--color-k-border)", fontWeight: 600, textAlign: "left" as const };
const tdStyle = { padding: "12px 16px", fontSize: 14, color: "var(--color-k-text-primary)", borderBottom: "1px solid var(--color-k-border)" };
const linkStyle = { color: "var(--color-k-navy)", textDecoration: "none", fontWeight: 600 };

function DrillDownSection({ includeTestAccounts }: { includeTestAccounts: boolean }) {
  const [activeTab, setActiveTab] = useState<"families" | "children" | "parents">("parents");
  const [listData, setListData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/retention/${activeTab}?includeTestAccounts=${includeTestAccounts}`)
      .then(res => res.json())
      .then(d => {
        if (activeTab === "families") setListData(d.families || []);
        if (activeTab === "children") setListData(d.children || []);
        if (activeTab === "parents") setListData(d.parents || []);
        setLoading(false);
      })
      .catch(() => {
        setListData([]);
        setLoading(false);
      });
  }, [activeTab, includeTestAccounts]);

  return (
    <div style={{ marginTop: 40 }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: "var(--color-k-text-primary)", marginBottom: 16 }}>사용자별 상세 드릴다운</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["parents", "children", "families"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              border: activeTab === tab ? "1px solid var(--color-k-navy)" : "1px solid var(--color-k-border)",
              background: activeTab === tab ? "var(--color-k-navy)" : "white",
              color: activeTab === tab ? "white" : "var(--color-k-text-secondary)",
              fontSize: 14,
              fontWeight: activeTab === tab ? 700 : 400,
              cursor: "pointer",
            }}
          >
            {tab === "families" ? "가족 상세" : tab === "children" ? "아이 상세" : "부모 상세"}
          </button>
        ))}
      </div>

      <div style={{ background: "var(--color-k-background)", borderRadius: 12, overflow: "hidden", boxShadow: "var(--shadow-k-card)" }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--color-k-text-secondary)" }}>불러오는 중...</div>
        ) : !listData || listData.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--color-k-text-secondary)" }}>데이터가 없습니다.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", whiteSpace: "nowrap" }}>
              <thead style={{ background: "var(--color-k-navy-tint)" }}>
                <tr>
                  {activeTab === "families" && (
                    <>
                      <th style={thStyle}>가족 ID</th>
                      <th style={thStyle}>생성일</th>
                    </>
                  )}
                  {activeTab === "children" && (
                    <>
                      <th style={thStyle}>아이 ID</th>
                      <th style={thStyle}>학년</th>
                      <th style={thStyle}>활성 일수</th>
                      <th style={thStyle}>미션/자유대화/놀이 수</th>
                      <th style={thStyle}>D1/D7 재방문</th>
                    </>
                  )}
                  {activeTab === "parents" && (
                    <>
                      <th style={thStyle}>부모 ID</th>
                      <th style={thStyle}>가입일</th>
                      <th style={thStyle}>로그인/리포트/대화거리 뷰</th>
                      <th style={thStyle}>상태</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {listData.map((item: any, i: number) => (
                  <tr key={i}>
                    {activeTab === "families" && (
                      <>
                        <td style={tdStyle}>{item.id}</td>
                        <td style={tdStyle}>{new Date(item.created_at || item.createdAt).toLocaleDateString()}</td>
                      </>
                    )}
                    {activeTab === "children" && (
                      <>
                        <td style={tdStyle}>{item.childId}</td>
                        <td style={tdStyle}>{item.grade}</td>
                        <td style={tdStyle}>{item.activeDaysTotal}일</td>
                        <td style={tdStyle}>{item.missionCount} / {item.freechatCount} / {item.playCount}</td>
                        <td style={tdStyle}>{(item.d1Retained ? "✅" : (item.d1Retained===false?"❌":"-"))} / {(item.d7Retained ? "✅" : (item.d7Retained===false?"❌":"-"))}</td>
                      </>
                    )}
                    {activeTab === "parents" && (
                      <>
                        <td style={tdStyle}>{item.actorId}</td>
                        <td style={tdStyle}>{new Date(item.joinedAt).toLocaleDateString()}</td>
                        <td style={tdStyle}>{item.visitCount} / {item.reportViewCount} / {item.topicViewCount}</td>
                        <td style={tdStyle}>
                          <span style={{ 
                            padding: "4px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600,
                            background: item.status.includes("오늘") || item.status.includes("3일") ? "var(--color-k-navy-tint)" : "var(--color-k-border)",
                            color: item.status.includes("오늘") || item.status.includes("3일") ? "var(--color-k-navy)" : "var(--color-k-text-secondary)"
                           }}>
                            {item.status}
                          </span>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminRetentionPage() {
  const [period, setPeriod] = useState<Period>("7d");
  const [includeTestAccounts, setIncludeTestAccounts] = useState(false);
  const [overview, setOverview] = useState<any>(null);
  const [cohort, setCohort] = useState<any>(null);
  const [features, setFeatures] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    
    Promise.all([
      fetch(`/api/admin/retention/overview?period=${period}&includeTestAccounts=${includeTestAccounts}`).then(r => r.ok ? r.json() : Promise.reject("overview error")),
      fetch(`/api/admin/retention/cohort?unit=child&cohortBasis=registration&includeTestAccounts=${includeTestAccounts}`).then(r => r.ok ? r.json() : Promise.reject("cohort error")),
      fetch(`/api/admin/retention/features?includeTestAccounts=${includeTestAccounts}`).then(r => r.ok ? r.json() : Promise.reject("features error"))
    ]).then(([o, c, f]) => {
      if (!cancelled) {
        setOverview(o);
        setCohort(c);
        setFeatures(f);
        setLoading(false);
      }
    }).catch(err => {
      if (!cancelled) {
        setError(String(err));
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [period, includeTestAccounts]);

  const featureChartData = useMemo(() => {
    if (!features?.features) return [];
    return features.features.map((f: any) => ({
      name: f.feature === 'mission' ? '미션' : f.feature === 'freechat' ? '자유대화' : f.feature === 'play' ? '놀이' : f.feature === 'daily_report' ? '일일 리포트' : '대화거리',
      진입: f.startCount,
      완료: f.completeCount || 0
    }));
  }, [features]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-k-surface, #fafaf8)", paddingBottom: 64 }}>
      <header style={{ background: "var(--color-k-background)", padding: "16px 20px", borderBottom: "1px solid var(--color-k-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--color-k-text-primary)" }}>사용자 리텐션 대시보드</h1>
          <Link href="/admin" style={{ fontSize: 13, color: "var(--color-k-navy)", textDecoration: "none" }}>← 관리자 홈</Link>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px" }}>
        {/* Filters */}
        <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap", alignItems: "center", background: "var(--color-k-background)", padding: "16px 24px", borderRadius: 12, boxShadow: "var(--shadow-k-card)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-k-text-secondary)" }}>조회 기간:</span>
            {(["7d", "14d", "30d", "month", "all"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 999,
                  border: period === p ? "1px solid var(--color-k-navy)" : "1px solid var(--color-k-border)",
                  background: period === p ? "var(--color-k-navy)" : "white",
                  color: period === p ? "white" : "var(--color-k-text-secondary)",
                  fontSize: 13,
                  fontWeight: period === p ? 700 : 400,
                  cursor: "pointer",
                }}
              >
                {p === "7d" ? "최근 7일" : p === "14d" ? "최근 14일" : p === "30d" ? "최근 30일" : p === "month" ? "이번 달" : "전체"}
              </button>
            ))}
          </div>

          <div style={{ width: 1, height: 24, background: "var(--color-k-border)", margin: "0 8px" }} />

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer", color: "var(--color-k-text-primary)" }}>
            <input 
              type="checkbox" 
              checked={includeTestAccounts} 
              onChange={e => setIncludeTestAccounts(e.target.checked)} 
              style={{ width: 16, height: 16, accentColor: "var(--color-k-navy)" }}
            />
            내부 테스트 계정 포함
          </label>
        </div>

        {error && (
          <div style={{ color: "var(--color-k-danger)", background: "#ffeef0", padding: "16px", borderRadius: 8, marginBottom: 24 }}>
            데이터를 불러오는 중 오류가 발생했습니다: {error}
          </div>
        )}

        {loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "var(--color-k-text-secondary)" }}>대시보드 데이터를 집계하는 중입니다...</div>
        ) : overview && cohort ? (
          <>
            {/* KPI Cards */}
            <div style={{ marginBottom: 40 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 16, color: "var(--color-k-text-primary)" }}>사용자 규모 및 리텐션 핵심 지표</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
                <MetricCard 
                  label="승인 부모 수 (기간 내 활성)" 
                  value={`${overview.kpis.activeParents.value}명`} 
                  deltaPct={overview.kpis.activeParents.deltaPct}
                  actualString={`전체 방문 ${overview.kpis.visitingParents.value}명 중 실사용`}
                />
                <MetricCard 
                  label="활성 아이 수" 
                  value={`${overview.kpis.activeChildren.value}명`} 
                  deltaPct={overview.kpis.activeChildren.deltaPct}
                  actualString={`전체 로그인 ${overview.kpis.visitingChildren.value}명 중 활동`}
                />
                <MetricCard 
                  label="가족 동시 활성 (부모+아이)" 
                  value={`${overview.kpis.dualActivationFamilies.value}가족`} 
                  deltaPct={overview.kpis.dualActivationFamilies.deltaPct}
                />
                
                {/* Cohort D-Retention from overview or cohort summary */}
                <MetricCard 
                  label="D1 리텐션 (가입 코호트)" 
                  value={pct(cohort.summary.d1.rate)} 
                  actualString={`대상 ${cohort.summary.d1.denominator}명 중 ${cohort.summary.d1.numerator}명`}
                />
                <MetricCard 
                  label="D3 리텐션" 
                  value={pct(cohort.summary.d3.rate)} 
                  actualString={`대상 ${cohort.summary.d3.denominator}명 중 ${cohort.summary.d3.numerator}명`}
                />
                <MetricCard 
                  label="D7 리텐션" 
                  value={pct(cohort.summary.d7.rate)} 
                  actualString={`대상 ${cohort.summary.d7.denominator}명 중 ${cohort.summary.d7.numerator}명`}
                />
                <MetricCard 
                  label="2주차 지속률 (W2)" 
                  value={pct(cohort.summary.w2.rate)} 
                  actualString={`대상 ${cohort.summary.w2.denominator}명 중 ${cohort.summary.w2.numerator}명`}
                  sub="가입 후 2주차(8~14일) 내 1회 이상 핵심 활동"
                />
                <MetricCard 
                  label="미션 완료율" 
                  value={pct(overview.kpis.totalSessions.value > 0 ? overview.kpis.missionCompletes.value / overview.kpis.missionStarts.value : 0)} 
                  actualString={`시작 ${overview.kpis.missionStarts.value}회 중 완료 ${overview.kpis.missionCompletes.value}회`}
                />
              </div>
            </div>

            {/* Daily Trend Chart */}
            <div style={{ marginBottom: 40, background: "var(--color-k-background)", borderRadius: 14, padding: "24px", boxShadow: "var(--shadow-k-card)" }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 24, color: "var(--color-k-text-primary)" }}>일별 활성 사용자 추이 (DAU)</h2>
              <div style={{ height: 300, width: "100%" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={overview.dailyTrend} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-k-border)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: "var(--color-k-text-secondary)" }} tickMargin={12} />
                    <YAxis tick={{ fontSize: 12, fill: "var(--color-k-text-secondary)" }} axisLine={false} tickLine={false} />
                    <RechartsTooltip contentStyle={{ borderRadius: 8, border: "none", boxShadow: "var(--shadow-k-card)" }} />
                    <Legend wrapperStyle={{ fontSize: 13, paddingTop: 16 }} />
                    <Line type="monotone" dataKey="activeParents" name="부모 실활성" stroke="var(--color-k-primary)" strokeWidth={3} dot={{ r: 4, fill: "var(--color-k-primary)" }} activeDot={{ r: 6 }} />
                    <Line type="monotone" dataKey="activeChildren" name="아이 실활성" stroke="var(--color-k-navy)" strokeWidth={3} dot={{ r: 4, fill: "var(--color-k-navy)" }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 40 }}>
              {/* Funnel Chart */}
              <div style={{ background: "var(--color-k-background)", borderRadius: 14, padding: "24px", boxShadow: "var(--shadow-k-card)" }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 24, color: "var(--color-k-text-primary)" }}>핵심 행동 퍼널 전환</h2>
                <div style={{ height: 300, width: "100%" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={featureChartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-k-border)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: "var(--color-k-text-secondary)" }} />
                      <YAxis tick={{ fontSize: 12, fill: "var(--color-k-text-secondary)" }} axisLine={false} tickLine={false} />
                      <RechartsTooltip contentStyle={{ borderRadius: 8, border: "none", boxShadow: "var(--shadow-k-card)" }} />
                      <Legend wrapperStyle={{ fontSize: 13 }} />
                      <Bar dataKey="진입" fill="var(--color-k-border)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="완료" fill="var(--color-k-navy)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Cohort Table */}
              <div style={{ background: "var(--color-k-background)", borderRadius: 14, padding: "24px", boxShadow: "var(--shadow-k-card)", overflowX: "auto" }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 16, color: "var(--color-k-text-primary)" }}>가입 코호트 리텐션 (아이 기준)</h2>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "center", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, textAlign: "center" }}>가입 주차</th>
                      <th style={{ ...thStyle, textAlign: "center" }}>모수</th>
                      <th style={{ ...thStyle, textAlign: "center" }}>D1</th>
                      <th style={{ ...thStyle, textAlign: "center" }}>D3</th>
                      <th style={{ ...thStyle, textAlign: "center" }}>D7</th>
                      <th style={{ ...thStyle, textAlign: "center" }}>D14</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cohort.cohorts.slice().reverse().map((c: any, idx: number) => (
                      <tr key={idx}>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{c.cohortLabel}</td>
                        <td style={{ ...tdStyle, fontWeight: 600, color: "var(--color-k-navy)" }}>{c.size}명</td>
                        <td style={{ ...tdStyle, background: c.d1.rate !== null ? `rgba(45, 159, 143, ${c.d1.rate * 0.8})` : "transparent" }}>
                          {c.d1.rate !== null ? <>{pct(c.d1.rate)} <br/><span style={{ fontSize: 11, color: "var(--color-k-text-secondary)" }}>{c.d1.numerator}명</span></> : "-"}
                        </td>
                        <td style={{ ...tdStyle, background: c.d3.rate !== null ? `rgba(45, 159, 143, ${c.d3.rate * 0.8})` : "transparent" }}>
                          {c.d3.rate !== null ? <>{pct(c.d3.rate)} <br/><span style={{ fontSize: 11, color: "var(--color-k-text-secondary)" }}>{c.d3.numerator}명</span></> : "-"}
                        </td>
                        <td style={{ ...tdStyle, background: c.d7.rate !== null ? `rgba(45, 159, 143, ${c.d7.rate * 0.8})` : "transparent" }}>
                          {c.d7.rate !== null ? <>{pct(c.d7.rate)} <br/><span style={{ fontSize: 11, color: "var(--color-k-text-secondary)" }}>{c.d7.numerator}명</span></> : "-"}
                        </td>
                        <td style={{ ...tdStyle, background: c.d14.rate !== null ? `rgba(45, 159, 143, ${c.d14.rate * 0.8})` : "transparent" }}>
                          {c.d14.rate !== null ? <>{pct(c.d14.rate)} <br/><span style={{ fontSize: 11, color: "var(--color-k-text-secondary)" }}>{c.d14.numerator}명</span></> : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <DrillDownSection includeTestAccounts={includeTestAccounts} />
          </>
        ) : null}
      </main>
    </div>
  );
}
