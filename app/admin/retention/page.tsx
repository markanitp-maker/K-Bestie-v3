"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Period = "today" | "7d" | "month";

interface PerChildDaily {
  childId: string;
  name: string;
  avgSessionsPerActiveDay: number;
  totalSessionsInPeriod: number;
  consecutiveDays: number;
}

interface RetentionData {
  period: Period;
  activeChildren: number;
  missionCompletionRate: number;
  avgSessionDurationSec: number;
  avgTurnsPerSession: number;
  dailyGoalAchievementRate: number;
  d1RetentionRate: number;
  d3RetentionRate: number;
  d7RetentionRate: number;
  d14RetentionRate: number;
  d30RetentionRate: number;
  perChildDaily: PerChildDaily[];
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}초`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}분 ${s}초`;
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: "var(--hb-card)", borderRadius: 14, boxShadow: "var(--hb-shadow)", padding: "18px 22px" }}>
      <div style={{ fontSize: 13, color: "var(--hb-muted)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: "clamp(18px, 2vw, 28px)", fontWeight: 800, color: "#1e1e2d" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--hb-muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

const thStyle = { padding: "12px 16px", fontSize: 13, color: "var(--hb-muted)", borderBottom: "1px solid var(--hb-border)" };
const tdStyle = { padding: "12px 16px", fontSize: 14, color: "#1e1e2d" };
const linkStyle = { color: "var(--hb-primary)", textDecoration: "none", fontWeight: 600 };

function DrillDownSection() {
  const [activeTab, setActiveTab] = useState<"families" | "children" | "parents">("families");
  const [listData, setListData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/retention/${activeTab}`)
      .then(res => res.json())
      .then(d => {
        if (activeTab === "families") setListData(d.families);
        if (activeTab === "children") setListData(d.children);
        if (activeTab === "parents") setListData(d.parents);
        setLoading(false);
      });
  }, [activeTab]);

  return (
    <div style={{ marginTop: 40 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#1e1e2d", marginBottom: 16 }}>드릴다운 상세 보기</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["families", "children", "parents"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              border: activeTab === tab ? "1px solid var(--hb-primary)" : "1px solid var(--hb-border)",
              background: activeTab === tab ? "var(--hb-primary)" : "white",
              color: activeTab === tab ? "white" : "var(--hb-muted)",
              fontSize: 14,
              fontWeight: activeTab === tab ? 700 : 400,
              cursor: "pointer",
            }}
          >
            {tab === "families" ? "가족 목록" : tab === "children" ? "아이 목록" : "부모 목록"}
          </button>
        ))}
      </div>

      <div style={{ background: "var(--hb-card)", borderRadius: 12, overflow: "hidden", boxShadow: "var(--hb-shadow)" }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--hb-muted)" }}>불러오는 중...</div>
        ) : !listData || listData.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--hb-muted)" }}>데이터가 없습니다.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", whiteSpace: "nowrap" }}>
              <thead style={{ background: "var(--hb-primary-light)" }}>
                <tr>
                  {activeTab === "families" && (
                    <>
                      <th style={thStyle}>가족 ID</th>
                      <th style={thStyle}>가입일</th>
                      <th style={thStyle}>부모 수</th>
                      <th style={thStyle}>아이 수</th>
                      <th style={thStyle}>최근 7일 동시활성</th>
                    </>
                  )}
                  {activeTab === "children" && (
                    <>
                      <th style={thStyle}>아이 ID</th>
                      <th style={thStyle}>학년</th>
                      <th style={thStyle}>활성 일수</th>
                      <th style={thStyle}>미션/대화/놀이 수</th>
                      <th style={thStyle}>D1/D7 재방문</th>
                    </>
                  )}
                  {activeTab === "parents" && (
                    <>
                      <th style={thStyle}>부모 ID</th>
                      <th style={thStyle}>가족 ID</th>
                      <th style={thStyle}>방문/리포트/토픽 수</th>
                      <th style={thStyle}>상태</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {listData.map((item: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--hb-border)" }}>
                    {activeTab === "families" && (
                      <>
                        <td style={tdStyle}><Link href={`/admin/retention/families/${item.familyId}`} style={linkStyle}>{item.familyId}</Link></td>
                        <td style={tdStyle}>{new Date(item.createdAt).toLocaleDateString()}</td>
                        <td style={tdStyle}>{item.parentCount}명</td>
                        <td style={tdStyle}>{item.childCount}명</td>
                        <td style={tdStyle}>{item.dualActive7d ? "✅" : "-"}</td>
                      </>
                    )}
                    {activeTab === "children" && (
                      <>
                        <td style={tdStyle}><Link href={`/admin/retention/children/${item.childId}`} style={linkStyle}>{item.childId}</Link></td>
                        <td style={tdStyle}>{item.grade}</td>
                        <td style={tdStyle}>{item.activeDaysTotal}일</td>
                        <td style={tdStyle}>{item.missionCount} / {item.freechatCount} / {item.playCount}</td>
                        <td style={tdStyle}>{(item.d1Retained ? "✅" : (item.d1Retained===false?"❌":"-"))} / {(item.d7Retained ? "✅" : (item.d7Retained===false?"❌":"-"))}</td>
                      </>
                    )}
                    {activeTab === "parents" && (
                      <>
                        <td style={tdStyle}><Link href={`/admin/retention/parents/${item.actorId}`} style={linkStyle}>{item.actorId}</Link></td>
                        <td style={tdStyle}><Link href={`/admin/retention/families/${item.familyId}`} style={linkStyle}>{item.familyId}</Link></td>
                        <td style={tdStyle}>{item.visitCount} / {item.reportViewCount} / {item.topicViewCount}</td>
                        <td style={tdStyle}>{item.status}</td>
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
  const [data, setData] = useState<RetentionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/retention?period=${period}`)
      .then(res => {
        if (!res.ok) throw new Error("데이터를 불러오지 못했습니다.");
        return res.json();
      })
      .then((d: RetentionData) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [period]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--hb-bg, #fafaf8)", paddingBottom: 64 }}>
      <header style={{ background: "var(--hb-card)", padding: "16px 20px", borderBottom: "1px solid var(--hb-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1e1e2d" }}>케이 리텐션 지표 (베타)</h1>
          <Link href="/admin" style={{ fontSize: 13, color: "var(--hb-primary)", textDecoration: "none" }}>← 전체 현황으로 돌아가기</Link>
        </div>
      </header>

      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 20px" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 24, justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {(["today", "7d", "month"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 999,
                  border: period === p ? "1px solid var(--hb-primary)" : "1px solid var(--hb-border)",
                  background: period === p ? "var(--hb-primary)" : "white",
                  color: period === p ? "white" : "var(--hb-muted)",
                  fontSize: 14,
                  fontWeight: period === p ? 700 : 400,
                  cursor: "pointer",
                }}
              >
                {p === "today" ? "오늘" : p === "7d" ? "최근 7일" : "이번 달"}
              </button>
            ))}
          </div>
          <a
            href={`/api/admin/retention/export?period=${period}`}
            download
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              background: "#1e1e2d",
              color: "white",
              fontSize: 14,
              fontWeight: 700,
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              gap: 6
            }}
          >
            CSV 다운로드
          </a>
        </div>

        {error && (
          <div style={{ color: "var(--hb-danger)", background: "#ffeef0", padding: "16px", borderRadius: 8 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "var(--hb-muted)" }}>불러오는 중...</div>
        ) : data ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 32 }}>
              <MetricCard label="접속 아이 수" value={`${data.activeChildren}명`} sub="테스트/데모 계정 제외" />
              <MetricCard label="미션 완료율" value={pct(data.missionCompletionRate)} sub="미션 세션 중 완료(COMPLETED) 비율" />
              <MetricCard label="하루 2회 미션 목표 달성률" value={pct(data.dailyGoalAchievementRate)} sub="접속일 기준 평균 (최대 2회)" />
              <MetricCard label="평균 체류시간" value={formatDuration(data.avgSessionDurationSec)} sub="세션 1회당 평균" />
              <MetricCard label="대화 턴 수" value={`${data.avgTurnsPerSession.toFixed(1)}턴`} sub="세션 1회당 오가는 메시지 수" />
              <MetricCard label="D1 재방문율" value={pct(data.d1RetentionRate)} sub="전날 접속자 중 오늘 재접속한 비율" />
              <MetricCard label="D3 재방문율" value={pct(data.d3RetentionRate)} sub="3일 전 접속자 중 오늘 재접속한 비율" />
              <MetricCard label="D7 재방문율" value={pct(data.d7RetentionRate)} sub="7일 전 접속자 중 오늘 재접속한 비율" />
              <MetricCard label="D14 재방문율" value={pct(data.d14RetentionRate)} sub="14일 전 접속자 중 오늘 재접속한 비율" />
              <MetricCard label="D30 재방문율" value={pct(data.d30RetentionRate)} sub="30일 전 접속자 중 오늘 재접속한 비율" />
            </div>

            <div style={{ fontSize: 16, fontWeight: 700, color: "#1e1e2d", marginBottom: 12 }}>아이별 접속 요약</div>
            <div style={{ background: "var(--hb-card)", borderRadius: 12, overflow: "hidden", boxShadow: "var(--hb-shadow)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                <thead>
                  <tr style={{ background: "var(--hb-primary-light)" }}>
                    <th style={{ padding: "12px 16px", fontSize: 13, color: "var(--hb-muted)", borderBottom: "1px solid var(--hb-border)" }}>아이 이름</th>
                    <th style={{ padding: "12px 16px", fontSize: 13, color: "var(--hb-muted)", borderBottom: "1px solid var(--hb-border)" }}>현재 연속 접속 일수</th>
                    <th style={{ padding: "12px 16px", fontSize: 13, color: "var(--hb-muted)", borderBottom: "1px solid var(--hb-border)" }}>기간 내 총 세션 수</th>
                    <th style={{ padding: "12px 16px", fontSize: 13, color: "var(--hb-muted)", borderBottom: "1px solid var(--hb-border)" }}>접속일 평균 세션 수</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perChildDaily.length === 0 ? (
                    <tr><td colSpan={4} style={{ padding: 24, textAlign: "center", color: "var(--hb-muted)", fontSize: 13 }}>데이터가 없습니다.</td></tr>
                  ) : (
                    data.perChildDaily.map((child) => (
                      <tr key={child.childId}>
                        <td style={{ padding: "12px 16px", fontSize: 14, color: "#1e1e2d", borderBottom: "1px solid var(--hb-border)" }}>
                          {child.name}
                          <div style={{ fontSize: 11, color: "var(--hb-muted)" }}>{child.childId.split("-")[0]}...</div>
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 14, color: "#1e1e2d", borderBottom: "1px solid var(--hb-border)" }}>{child.consecutiveDays}일째</td>
                        <td style={{ padding: "12px 16px", fontSize: 14, color: "#1e1e2d", borderBottom: "1px solid var(--hb-border)" }}>{child.totalSessionsInPeriod}회</td>
                        <td style={{ padding: "12px 16px", fontSize: 14, color: "#1e1e2d", borderBottom: "1px solid var(--hb-border)" }}>일 {child.avgSessionsPerActiveDay}회</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <DrillDownSection />
          </>
        ) : null}
      </main>
    </div>
  );
}
