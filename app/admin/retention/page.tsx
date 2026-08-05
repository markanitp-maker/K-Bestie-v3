"use client";

import { useEffect, useState, useMemo, useRef, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AdminResponsiveTable } from "@/components/admin/shell/AdminResponsiveTable";
import { AdminFilterBar } from "@/components/admin/shell/AdminFilterBar";
import { AdminKpiCard, AdminKpiGrid } from "@/components/admin/shell/AdminKpiCard";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, BarChart, Bar, Legend } from "recharts";
import { RetentionWidgetErrorBoundary } from "@/components/admin/RetentionWidgetErrorBoundary";
import { AdminPageHeader } from "@/components/admin/shell/AdminPageHeader";

// requests/064 — /admin(사이드바) iframe에서 로드될 때 ?embed=1로 접근한다.
// 이 페이지 자체의 헤더(내친구 케이 상단바는 app/admin/layout.tsx가 그리는 별개의
// 것이라 그대로 두고, 이 파일이 직접 그리는 "사용자 리텐션 대시보드" 제목+"←
// 관리자 홈" 링크만) 부모 프레임과 중복되므로 embed 모드에서 숨긴다. 직접
// /admin/retention으로 접근(embed 파라미터 없음)하면 기존과 동일하게 전체 표시.
const EMBED_HEIGHT_MESSAGE_TYPE = "k-bestie-retention-embed-height";

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
  const description = (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {actualString && <div style={{ fontSize: "var(--admin-text-xs)" }}>{actualString}</div>}
      {sub && <div style={{ fontSize: "var(--admin-text-xs)" }}>{sub}</div>}
    </div>
  );
  
  const formattedValue = (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      {value}
      {deltaPct !== undefined && deltaPct !== null && (
        <span style={{ fontSize: 14, color: deltaPct > 0 ? "var(--admin-primary)" : deltaPct < 0 ? "var(--admin-danger)" : "var(--admin-text-secondary)" }}>
          {deltaPct > 0 ? "▲" : deltaPct < 0 ? "▼" : "-"}{Math.abs(deltaPct)}%
        </span>
      )}
    </div>
  );

  return <AdminKpiCard title={label} value={formattedValue} description={description} />;
}

const thStyle = { padding: "12px 16px", fontSize: 13, color: "var(--admin-text-secondary)", borderBottom: "1px solid var(--admin-border)", fontWeight: 600, textAlign: "left" as const };
const tdStyle = { padding: "12px 16px", fontSize: 14, color: "var(--admin-text-primary)", borderBottom: "1px solid var(--admin-border)" };
const linkStyle = { color: "var(--admin-primary)", textDecoration: "none", fontWeight: 600 };

type Scope = "all" | "parent" | "child";
type DrillDownRowType = "all" | "parent" | "child" | "families";

function retainCell(v: boolean | null | undefined) {
  return v === true ? "✅" : v === false ? "❌" : "-";
}

function StatusBadge({ status }: { status: string }) {
  const isRecent = status.includes("오늘") || status.includes("3일");
  return (
    <span style={{
      padding: "4px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600,
      background: isRecent ? "var(--admin-primary-tint)" : "var(--admin-border)",
      color: isRecent ? "var(--admin-primary)" : "var(--admin-text-secondary)"
    }}>
      {status || "-"}
    </span>
  );
}

// requests/062 §15 — 로그인 아이디가 길면 말줄임, hover 시 전체 로그인 아이디(전체
// UUID는 절대 아님) 확인 가능. 이름/로그인ID 둘 다 없으면 마스킹 UUID만 표시.
function IdentityCell({ name, loginId, maskedId }: { name?: string | null; loginId?: string | null; maskedId?: string }) {
  if (!name && !loginId) return <span style={{ color: "var(--admin-text-secondary)" }}>{maskedId ?? "-"}</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 200 }}>
      {name && <span style={{ fontWeight: 600 }}>{name}</span>}
      {loginId && (
        <span title={loginId} style={{ fontSize: 11, color: "var(--admin-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {loginId}
        </span>
      )}
    </div>
  );
}

function DrillDownSection({ scope, includeTestAccounts }: { scope: Scope; includeTestAccounts: boolean }) {
  const [showFamilies, setShowFamilies] = useState(false);
  const [listType, setListType] = useState<DrillDownRowType>("all");
  const [listData, setListData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  // scope 탭을 바꾸면 가족 상세 오버라이드는 해제하고 scope 기준 뷰로 되돌아간다.
  useEffect(() => { setShowFamilies(false); }, [scope]);

  useEffect(() => {
    // requests/061과 동일한 패턴 — fetch 시점 값을 고정하고 cancelled 플래그로
    // 늦게 도착한 응답이 최신 상태를 덮어쓰지 않게 막는다.
    const requestedType: DrillDownRowType = showFamilies ? "families" : scope;
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        if (requestedType === "families") {
          const res = await fetch(`/api/admin/retention/families?includeTestAccounts=${includeTestAccounts}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const d = await res.json();
          if (cancelled) return;
          setListType("families");
          setListData(d.families ?? []);
        } else if (requestedType === "all") {
          const [pRes, cRes] = await Promise.all([
            fetch(`/api/admin/retention/parents?includeTestAccounts=${includeTestAccounts}`),
            fetch(`/api/admin/retention/children?includeTestAccounts=${includeTestAccounts}`),
          ]);
          if (!pRes.ok || !cRes.ok) throw new Error("HTTP error");
          const [pD, cD] = await Promise.all([pRes.json(), cRes.json()]);
          if (cancelled) return;
          const merged = [
            ...(pD.parents ?? []).map((p: any) => ({ ...p, userType: "parent" as const })),
            ...(cD.children ?? []).map((c: any) => ({ ...c, userType: "child" as const })),
          ];
          setListType("all");
          setListData(merged);
        } else {
          const endpoint = requestedType === "parent" ? "parents" : "children";
          const res = await fetch(`/api/admin/retention/${endpoint}?includeTestAccounts=${includeTestAccounts}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const d = await res.json();
          if (cancelled) return;
          setListType(requestedType);
          setListData(requestedType === "parent" ? (d.parents ?? []) : (d.children ?? []));
        }
      } catch {
        if (!cancelled) {
          setListType(requestedType);
          setListData([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [scope, showFamilies, includeTestAccounts]);

  const title = showFamilies ? "가족 상세" : scope === "all" ? "전체 상세 (부모+아이)" : scope === "parent" ? "부모 상세" : "아이 상세";

  return (
    <div style={{ marginTop: "var(--admin-space-40)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--admin-space-16)" }}>
        <div style={{ fontSize: "var(--admin-text-lg)", fontWeight: "var(--admin-weight-bold)", color: "var(--admin-text-primary)" }}>사용자별 상세 드릴다운 — {title}</div>
        <button
          onClick={() => setShowFamilies(v => !v)}
          style={{
            padding: "6px 14px",
            borderRadius: 999,
            border: showFamilies ? "1px solid var(--admin-primary)" : "1px solid var(--admin-border)",
            background: showFamilies ? "var(--admin-primary)" : "white",
            color: showFamilies ? "white" : "var(--admin-text-secondary)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {showFamilies ? "◀ scope 기준으로" : "가족 상세 보기"}
        </button>
      </div>

      <div style={{ background: "var(--admin-surface)", borderRadius: 16, overflow: "hidden", border: "1px solid var(--admin-border)" }}>
        {loading ? (
          <div style={{ padding: "var(--admin-space-24)", textAlign: "center", color: "var(--admin-text-secondary)" }}>불러오는 중...</div>
        ) : !listData || listData.length === 0 ? (
          <div style={{ padding: "var(--admin-space-24)", textAlign: "center", color: "var(--admin-text-secondary)" }}>데이터가 없습니다.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <AdminResponsiveTable mobileStrategy="card"
              columns={
                listType === "families" ? [
                  { key: "family", header: "가족", render: (item: any) => <IdentityCell name={item.representativeParentName} loginId={item.representativeLoginId} maskedId={item.maskedId} /> },
                  { key: "createdAt", header: "생성일", render: (item: any) => new Date(item.createdAt).toLocaleDateString() },
                  { key: "count", header: "부모/아이 수", render: (item: any) => `${item.parentCount} / ${item.childCount}` },
                  { key: "active", header: "동시 활성(7일)", render: (item: any) => item.dualActive7d ? "✅" : "-" },
                ] : listType === "all" ? [
                  { key: "type", header: "유형", render: (item: any) => item.userType === "parent" ? "부모" : "아이" },
                  { key: "user", header: "사용자", render: (item: any) => <IdentityCell name={item.name} loginId={item.loginId} maskedId={item.maskedId} /> },
                  { key: "activeDays", header: "활성 일수", render: (item: any) => `${item.activeDaysTotal ?? 0}일` },
                  { key: "retention", header: "D1/D3/D7", render: (item: any) => `${retainCell(item.d1Retained)} / ${retainCell(item.d3Retained)} / ${retainCell(item.d7Retained)}` },
                ] : listType === "child" ? [
                  { key: "child", header: "아이", render: (item: any) => <IdentityCell name={item.name} loginId={item.loginId} maskedId={item.maskedId} /> },
                  { key: "grade", header: "학년", render: (item: any) => item.grade },
                  { key: "activeDays", header: "활성 일수", render: (item: any) => `${item.activeDaysTotal}일` },
                  { key: "counts", header: "미션/자유대화/놀이 수", render: (item: any) => `${item.missionCount} / ${item.freechatCount} / ${item.playCount}` },
                  { key: "retention", header: "D1/D3/D7", render: (item: any) => `${retainCell(item.d1Retained)} / ${retainCell(item.d3Retained)} / ${retainCell(item.d7Retained)}` },
                ] : [
                  { key: "parent", header: "부모", render: (item: any) => <IdentityCell name={item.name} loginId={item.loginId} maskedId={item.maskedId} /> },
                  { key: "joinedAt", header: "가입일", render: (item: any) => new Date(item.joinedAt).toLocaleDateString() },
                  { key: "counts", header: "로그인/리포트/대화거리 뷰", render: (item: any) => `${item.visitCount} / ${item.reportViewCount} / ${item.topicViewCount}` },
                  { key: "retention", header: "D1/D3/D7", render: (item: any) => `${retainCell(item.d1Retained)} / ${retainCell(item.d3Retained)} / ${retainCell(item.d7Retained)}` },
                  { key: "status", header: "상태", render: (item: any) => <StatusBadge status={item.status ?? ""} /> },
                ]
              }
              data={listData}
              keyExtractor={(item: any) => item.maskedId || item.loginId || item.representativeLoginId || Math.random().toString()}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const CHILD_FEATURES = new Set(["mission", "freechat", "play"]);
const PARENT_FEATURES = new Set(["daily_report", "conversation_topic"]);

function AdminRetentionContent() {
  const searchParams = useSearchParams();
  const embed = searchParams.get("embed") === "1";
  const rootRef = useRef<HTMLDivElement>(null);

  // requests/064 — embed 모드에서만 콘텐츠 높이를 부모(app/admin/page.tsx의
  // iframe 래퍼)에 postMessage로 보고한다. 부모가 iframe height를 이 값에 맞춰
  // 갱신하면 iframe 자체는 내부 스크롤 없이(overflow hidden) 항상 콘텐츠 전체가
  // 보이고, 스크롤은 바깥 /admin 페이지 하나에서만 발생해 이중 스크롤이 없다.
  useEffect(() => {
    if (!embed || !rootRef.current) return;
    const el = rootRef.current;
    const report = () => {
      window.parent.postMessage(
        { type: EMBED_HEIGHT_MESSAGE_TYPE, height: el.scrollHeight },
        window.location.origin
      );
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [embed]);

  const [period, setPeriod] = useState<Period>("7d");
  const [scope, setScope] = useState<Scope>("all");
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
      fetch(`/api/admin/retention/cohort?unit=${scope}&cohortBasis=registration&includeTestAccounts=${includeTestAccounts}`).then(r => r.ok ? r.json() : Promise.reject("cohort error")),
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
  }, [period, scope, includeTestAccounts]);

  const featureChartData = useMemo(() => {
    if (!features?.features) return [];
    return features.features
      .filter((f: any) => scope === "all" || (scope === "child" && CHILD_FEATURES.has(f.feature)) || (scope === "parent" && PARENT_FEATURES.has(f.feature)))
      .map((f: any) => ({
        name: f.feature === 'mission' ? '미션' : f.feature === 'freechat' ? '자유대화' : f.feature === 'play' ? '놀이' : f.feature === 'daily_report' ? '일일 리포트' : '대화거리',
        진입: f.startCount,
        완료: f.completeCount || 0
      }));
  }, [features, scope]);

  return (
    <div ref={rootRef} style={{ minHeight: embed ? undefined : "100vh", width: "100%", background: "var(--admin-bg, #fafaf8)", paddingBottom: embed ? 0 : 64 }}>
      {!embed && (
        <div style={{ padding: "var(--admin-space-24) var(--admin-space-32) 0" }}>
          <AdminPageHeader 
            title="사용자 리텐션 대시보드" 
            action={<Link href="/admin" style={{ fontSize: "var(--admin-text-sm)", color: "var(--admin-primary)", textDecoration: "none" }}>← 관리자 홈</Link>} 
          />
        </div>
      )}

      <main style={embed ? { width: "100%", padding: 0 } : { width: "100%", maxWidth: 1600, margin: "0 auto", padding: "0 var(--admin-space-32) var(--admin-space-48)" }}>
        {/* requests/063 §3 — 전체/부모/아이 리텐션 scope 탭. 기본값 전체 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {([["all", "전체 리텐션"], ["parent", "부모 리텐션"], ["child", "아이 리텐션"]] as const).map(([s, label]) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              style={{
                padding: "8px 18px",
                borderRadius: 999,
                border: scope === s ? "1px solid var(--admin-primary)" : "1px solid var(--admin-border)",
                background: scope === s ? "var(--admin-primary)" : "white",
                color: scope === s ? "white" : "var(--admin-text-secondary)",
                fontSize: 14,
                fontWeight: scope === s ? 700 : 500,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Filters */}
        <AdminFilterBar
          filterNodes={[
            <div key="period" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--admin-text-secondary)" }}>조회 기간:</span>
              {(["7d", "14d", "30d", "month", "all"] as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 999,
                    border: period === p ? "1px solid var(--admin-primary)" : "1px solid var(--admin-border)",
                    background: period === p ? "var(--admin-primary)" : "white",
                    color: period === p ? "white" : "var(--admin-text-secondary)",
                    fontSize: 13,
                    fontWeight: period === p ? 700 : 400,
                    cursor: "pointer",
                  }}
                >
                  {p === "7d" ? "최근 7일" : p === "14d" ? "최근 14일" : p === "30d" ? "최근 30일" : p === "month" ? "이번 달" : "전체"}
                </button>
              ))}
            </div>,
            <label key="testAccount" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer", color: "var(--admin-text-primary)" }}>
              <input 
                type="checkbox" 
                checked={includeTestAccounts} 
                onChange={e => setIncludeTestAccounts(e.target.checked)} 
                style={{ width: 16, height: 16, accentColor: "var(--admin-primary)" }}
              />
              내부 테스트 계정 포함
            </label>,
            <a
              key="export"
              href={`/api/admin/retention/export?scope=${scope}&includeTestAccounts=${includeTestAccounts}`}
              download
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                background: "var(--admin-text-primary)",
                color: "white",
                fontSize: 13,
                fontWeight: 600,
                textDecoration: "none",
                marginLeft: "auto"
              }}
            >
              CSV 다운로드
            </a>
          ]}
        />

        {error && (
          <div style={{ color: "var(--admin-danger)", background: "#ffeef0", padding: "var(--admin-space-16)", borderRadius: 8, marginBottom: "var(--admin-space-24)" }}>
            데이터를 불러오는 중 오류가 발생했습니다: {error}
          </div>
        )}

        {loading ? (
          <div style={{ padding: "var(--admin-space-40)", textAlign: "center", color: "var(--admin-text-secondary)" }}>대시보드 데이터를 집계하는 중입니다...</div>
        ) : overview && cohort ? (
          <>
            {/* KPI Cards */}
            <RetentionWidgetErrorBoundary label="핵심 지표">
            <div style={{ marginBottom: "var(--admin-space-40)" }}>
              <h2 style={{ fontSize: "var(--admin-text-lg)", fontWeight: "var(--admin-weight-bold)", marginBottom: "var(--admin-space-16)", color: "var(--admin-text-primary)" }}>사용자 규모 및 리텐션 핵심 지표</h2>
              <AdminKpiGrid>

                {/* requests/063 §14 — scope별 UI 문구. 활성 사용자 수는 scope에 따라
                    전체(부모+아이 독립 합산)/부모만/아이만으로 갈아끼운다. */}
                {scope === "all" && (
                  <MetricCard
                    label="전체 활성 사용자 수"
                    value={`${overview.kpis.activeParents.value + overview.kpis.activeChildren.value}명`}
                    actualString={`부모 ${overview.kpis.activeParents.value}명 + 아이 ${overview.kpis.activeChildren.value}명 (독립 합산, 가족 dedupe 없음)`}
                  />
                )}
                {scope === "parent" && (
                  <MetricCard
                    label="활성 부모 수"
                    value={`${overview.kpis.activeParents.value}명`}
                    deltaPct={overview.kpis.activeParents.deltaPct}
                    actualString={`전체 방문 ${overview.kpis.visitingParents.value}명 중 실사용`}
                  />
                )}
                {scope === "child" && (
                  <MetricCard
                    label="활성 아이 수"
                    value={`${overview.kpis.activeChildren.value}명`}
                    deltaPct={overview.kpis.activeChildren.deltaPct}
                    actualString={`전체 로그인 ${overview.kpis.visitingChildren.value}명 중 활동`}
                  />
                )}
                <MetricCard
                  label="가족 동시 활성 (부모+아이)"
                  value={`${overview.kpis.dualActivationFamilies.value}가족`}
                  deltaPct={overview.kpis.dualActivationFamilies.deltaPct}
                  sub="참고용 보조 카드 (리텐션 scope 계산에 미포함)"
                />

                {/* Cohort D-Retention — cohort API가 scope(unit)에 맞춰 이미 계산해 옴 */}
                <MetricCard
                  label={`${scope === "all" ? "전체" : scope === "parent" ? "부모" : "아이"} D1 리텐션 (가입 코호트)`}
                  value={pct(cohort.summary.d1.rate)}
                  actualString={`대상 ${cohort.summary.d1.denominator}명 중 ${cohort.summary.d1.numerator}명`}
                />
                <MetricCard
                  label={`${scope === "all" ? "전체" : scope === "parent" ? "부모" : "아이"} D3 리텐션`}
                  value={pct(cohort.summary.d3.rate)}
                  actualString={`대상 ${cohort.summary.d3.denominator}명 중 ${cohort.summary.d3.numerator}명`}
                />
                <MetricCard
                  label={`${scope === "all" ? "전체" : scope === "parent" ? "부모" : "아이"} D7 리텐션`}
                  value={pct(cohort.summary.d7.rate)}
                  actualString={`대상 ${cohort.summary.d7.denominator}명 중 ${cohort.summary.d7.numerator}명`}
                />
                <MetricCard
                  label={`${scope === "all" ? "전체" : scope === "parent" ? "부모" : "아이"} 2주차 지속률 (W2)`}
                  value={pct(cohort.summary.w2.rate)}
                  actualString={`대상 ${cohort.summary.w2.denominator}명 중 ${cohort.summary.w2.numerator}명`}
                  sub="가입 후 2주차(8~14일) 내 1회 이상 핵심 활동"
                />

                {scope === "parent" && (
                  <MetricCard
                    label="리포트 조회 부모 수"
                    value={`${overview.kpis.reportViewingParents.value}명`}
                    deltaPct={overview.kpis.reportViewingParents.deltaPct}
                  />
                )}
                {(scope === "all" || scope === "child") && (
                  <MetricCard
                    label="미션 완료율"
                    value={pct(overview.kpis.missionStarts.value > 0 ? overview.kpis.missionCompletes.value / overview.kpis.missionStarts.value : 0)}
                    actualString={`시작 ${overview.kpis.missionStarts.value}회 중 완료 ${overview.kpis.missionCompletes.value}회`}
                  />
                )}
              </AdminKpiGrid>
            </div>
            </RetentionWidgetErrorBoundary>

            {/* Daily Trend Chart */}
            <RetentionWidgetErrorBoundary label="일별 활성 사용자 추이(DAU)">
            <div style={{ marginBottom: "var(--admin-space-40)", background: "var(--admin-surface)", borderRadius: 16, padding: "var(--admin-space-24)", border: "1px solid var(--admin-border)" }}>
              <h2 style={{ fontSize: "var(--admin-text-lg)", fontWeight: "var(--admin-weight-bold)", marginBottom: "var(--admin-space-24)", color: "var(--admin-text-primary)" }}>일별 활성 사용자 추이 (DAU)</h2>
              <div style={{ height: 300, width: "100%" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={overview.dailyTrend} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--admin-border)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: "var(--admin-text-secondary)" }} tickMargin={12} />
                    <YAxis tick={{ fontSize: 12, fill: "var(--admin-text-secondary)" }} axisLine={false} tickLine={false} />
                    <RechartsTooltip contentStyle={{ borderRadius: 8, border: "none", boxShadow: "var(--shadow-k-card)" }} />
                    <Legend wrapperStyle={{ fontSize: 13, paddingTop: 16 }} />
                    {(scope === "all" || scope === "parent") && (
                      <Line type="monotone" dataKey="activeParents" name="부모 실활성" stroke="var(--admin-warning)" strokeWidth={3} dot={{ r: 4, fill: "var(--admin-warning)" }} activeDot={{ r: 6 }} />
                    )}
                    {(scope === "all" || scope === "child") && (
                      <Line type="monotone" dataKey="activeChildren" name="아이 실활성" stroke="var(--admin-primary)" strokeWidth={3} dot={{ r: 4, fill: "var(--admin-primary)" }} activeDot={{ r: 6 }} />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            </RetentionWidgetErrorBoundary>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--admin-space-24)", marginBottom: "var(--admin-space-40)" }}>
              {/* Funnel Chart */}
              <RetentionWidgetErrorBoundary label="핵심 행동 퍼널 전환">
              <div style={{ background: "var(--admin-surface)", borderRadius: 16, padding: "var(--admin-space-24)", border: "1px solid var(--admin-border)" }}>
                <h2 style={{ fontSize: "var(--admin-text-lg)", fontWeight: "var(--admin-weight-bold)", marginBottom: "var(--admin-space-24)", color: "var(--admin-text-primary)" }}>핵심 행동 퍼널 전환</h2>
                <div style={{ height: 300, width: "100%" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={featureChartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--admin-border)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: "var(--admin-text-secondary)" }} />
                      <YAxis tick={{ fontSize: 12, fill: "var(--admin-text-secondary)" }} axisLine={false} tickLine={false} />
                      <RechartsTooltip contentStyle={{ borderRadius: 8, border: "none", boxShadow: "var(--shadow-k-card)" }} />
                      <Legend wrapperStyle={{ fontSize: 13 }} />
                      <Bar dataKey="진입" fill="var(--admin-border)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="완료" fill="var(--admin-primary)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              </RetentionWidgetErrorBoundary>

              {/* Cohort Table */}
              <RetentionWidgetErrorBoundary label="가입 코호트 리텐션">
              <div style={{ background: "var(--admin-surface)", borderRadius: 16, padding: "var(--admin-space-24)", border: "1px solid var(--admin-border)", overflowX: "auto" }}>
                <h2 style={{ fontSize: "var(--admin-text-lg)", fontWeight: "var(--admin-weight-bold)", marginBottom: "var(--admin-space-16)", color: "var(--admin-text-primary)" }}>가입 코호트 리텐션 ({scope === "all" ? "전체" : scope === "parent" ? "부모" : "아이"} 기준)</h2>
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
                        <td style={{ ...tdStyle, fontWeight: 600, color: "var(--admin-primary)" }}>{c.size}명</td>
                        <td style={{ ...tdStyle, background: c.d1.rate !== null ? `rgba(45, 159, 143, ${c.d1.rate * 0.8})` : "transparent" }}>
                          {c.d1.rate !== null ? <>{pct(c.d1.rate)} <br/><span style={{ fontSize: 11, color: "var(--admin-text-secondary)" }}>{c.d1.numerator}명</span></> : "-"}
                        </td>
                        <td style={{ ...tdStyle, background: c.d3.rate !== null ? `rgba(45, 159, 143, ${c.d3.rate * 0.8})` : "transparent" }}>
                          {c.d3.rate !== null ? <>{pct(c.d3.rate)} <br/><span style={{ fontSize: 11, color: "var(--admin-text-secondary)" }}>{c.d3.numerator}명</span></> : "-"}
                        </td>
                        <td style={{ ...tdStyle, background: c.d7.rate !== null ? `rgba(45, 159, 143, ${c.d7.rate * 0.8})` : "transparent" }}>
                          {c.d7.rate !== null ? <>{pct(c.d7.rate)} <br/><span style={{ fontSize: 11, color: "var(--admin-text-secondary)" }}>{c.d7.numerator}명</span></> : "-"}
                        </td>
                        <td style={{ ...tdStyle, background: c.d14.rate !== null ? `rgba(45, 159, 143, ${c.d14.rate * 0.8})` : "transparent" }}>
                          {c.d14.rate !== null ? <>{pct(c.d14.rate)} <br/><span style={{ fontSize: 11, color: "var(--admin-text-secondary)" }}>{c.d14.numerator}명</span></> : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </RetentionWidgetErrorBoundary>
            </div>

            <RetentionWidgetErrorBoundary label="사용자별 상세 드릴다운">
              <DrillDownSection scope={scope} includeTestAccounts={includeTestAccounts} />
            </RetentionWidgetErrorBoundary>
          </>
        ) : null}
      </main>
    </div>
  );
}

export default function AdminRetentionPage() {
  return (
    <Suspense fallback={<div style={{ padding: "var(--admin-space-40)", textAlign: "center", color: "var(--admin-text-secondary)" }}>불러오는 중...</div>}>
      <AdminRetentionContent />
    </Suspense>
  );
}
