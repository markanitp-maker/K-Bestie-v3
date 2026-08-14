"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, X } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AdminShell, type AdminPageId } from "@/components/admin/shell/AdminShell";
import { AdminPageHeader } from "@/components/admin/shell/AdminPageHeader";
import { AdminKpiCard, AdminKpiGrid } from "@/components/admin/shell/AdminKpiCard";
import { AdminErrorState } from "@/components/admin/shell/AdminErrorState";
import { AdminResponsiveTable } from "@/components/admin/shell/AdminResponsiveTable";
import { RetentionPeopleTabs } from "@/components/admin/RetentionPeopleTabs";
import { buildAnalyticsKpis, type AnalyticsPeriod, type AnalyticsScope, type InternalTestMode } from "@/lib/admin/analytics";

const PERIODS: Array<[AnalyticsPeriod, string]> = [
  ["today", "오늘"], ["7d", "최근 7일"], ["14d", "최근 14일"], ["30d", "최근 30일"],
  ["month", "이번 달"], ["lastmonth", "지난달"], ["custom", "직접 기간"],
];
const SCOPES: Array<[AnalyticsScope, string]> = [["all", "전체"], ["family", "가족"], ["parent", "부모"], ["child", "아이"]];
type DetailTab = "all" | "family" | "parent" | "child";
type AnalysisTab = "overview" | "children" | "parents";

function safeArray<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
function percent(value: unknown): string { return value == null ? "-" : `${Number(value).toFixed(1)}%`; }
function retained(value: unknown): string { return value == null ? "-" : value ? "유지" : "미유지"; }
function date(value: unknown): string { return value ? new Date(String(value)).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) : "-"; }

function Section({ id, title, description, children }: { id?: string; title: string; description?: string; children: React.ReactNode }) {
  return <section id={id} className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 md:p-6">
    <div className="mb-4"><h2 className="m-0 text-lg font-bold text-[var(--admin-text-primary)]">{title}</h2>{description && <p className="mt-1 text-sm text-[var(--admin-text-secondary)]">{description}</p>}</div>
    {children}
  </section>;
}

function Status({ value }: { value: string }) {
  const config: Record<string, [string, string]> = {
    success: ["성공", "#047857"], failure: ["실패", "#b91c1c"], pending: ["대기", "#a16207"],
  };
  const [label, color] = config[value] ?? [value || "-", "#475569"];
  return <span className="inline-flex rounded-full px-2 py-1 text-xs font-bold" style={{ color, background: `${color}18` }}>{label}</span>;
}

function AdminAnalyticsContent() {
  const router = useRouter();
  const rawSearchParams = useSearchParams();
  const searchParams = useMemo(() => rawSearchParams ?? new URLSearchParams(), [rawSearchParams]);
  const [period, setPeriod] = useState<AnalyticsPeriod>((searchParams.get("period") as AnalyticsPeriod) || "7d");
  const [scope, setScope] = useState<AnalyticsScope>((searchParams.get("scope") as AnalyticsScope) || "all");
  const [internalTest, setInternalTest] = useState<InternalTestMode>((searchParams.get("internalTest") as InternalTestMode) || "exclude");
  const [customFrom, setCustomFrom] = useState(searchParams.get("from") || "");
  const [customTo, setCustomTo] = useState(searchParams.get("to") || "");
  const [appliedCustom, setAppliedCustom] = useState({ from: searchParams.get("from") || "", to: searchParams.get("to") || "" });
  const [reportStatus, setReportStatus] = useState(searchParams.get("reportStatus") || "all");
  const requestedTab = searchParams.get("tab");
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>(requestedTab === "children" || requestedTab === "parents" ? requestedTab : "overview");
  const [peopleQuery, setPeopleQuery] = useState("");
  const [detailTab, setDetailTab] = useState<DetailTab>("all");
  const [series, setSeries] = useState({ parent: true, child: true, total: true });
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<any>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ period, scope, internalTest, reportStatus, tab: analysisTab });
    if (period === "custom") { params.set("from", appliedCustom.from); params.set("to", appliedCustom.to); }
    return params;
  }, [period, scope, internalTest, reportStatus, analysisTab, appliedCustom]);
  const queryString = query.toString();
  const exportQueryString = analysisTab === "overview" ? queryString : peopleQuery || queryString;

  const load = useCallback(async () => {
    if (period === "custom" && (!appliedCustom.from || !appliedCustom.to)) return;
    if (analysisTab !== "overview") {
      history.replaceState(null, "", `/admin/analytics?${queryString}`);
      return;
    }
    setError(""); setData(null);
    try {
      const response = await fetch(`/api/admin/analytics?${queryString}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "통합 분석 데이터를 불러오지 못했습니다.");
      setData(payload);
      history.replaceState(null, "", `/admin/analytics?${queryString}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "통합 분석 데이터를 불러오지 못했습니다.");
    }
  }, [period, appliedCustom, analysisTab, queryString]);
  useEffect(() => { load(); }, [load, reload]);

  const onMenuChange = (id: AdminPageId) => {
    if (id === "analytics") return;
    if (id === "users") router.push("/admin/users");
    else if (id === "customer-requests") router.push("/admin/customer-requests");
    else router.push(`/admin?menu=${id}`);
  };
  const kpis = buildAnalyticsKpis(data);
  const daily = safeArray<any>(data?.retention?.overview?.dailyTrend).map((row) => ({ ...row, totalActive: Number(row.activeParents ?? 0) + Number(row.activeChildren ?? 0) }));
  const cohorts = safeArray<any>(data?.retention?.cohort?.cohorts).slice().reverse();
  const funnel = safeArray<any>(data?.reporting?.funnel);
  const quality = safeArray<any>(data?.reporting?.quality);
  const reportByChild = new Map(safeArray<any>(data?.reporting?.reportDetails).map((row) => [row.childId, row]));

  const detailRows = useMemo(() => {
    const details = data?.retention?.details ?? {};
    const families = safeArray<any>(details.families).map((row) => ({ ...row, _type: "family", _key: `family:${row.familyId}`, _name: row.displayLabel, _last: row.lastChildActivityAt || row.lastParentActivityAt, _active: row.activeDaysTotal, _missionAttempt: row.missionCount, _missionCompleted: row.completedMissionCount, _missionEvent: row.missionEventCompletedCount, _freechat: row.freechatCount, _play: row.playCount }));
    const parents = safeArray<any>(details.parents).map((row) => ({ ...row, _type: "parent", _key: `parent:${row.actorId}`, _name: row.displayLabel, _last: row.lastVisitAt, _active: row.activeDaysTotal, _mission: null, _freechat: null, _play: null }));
    const children = safeArray<any>(details.children).map((row) => ({ ...row, _type: "child", _key: `child:${row.childId}`, _name: row.displayLabel, _last: row.lastVisitAt || row.lastActivityAt, _active: row.activeDaysTotal, _missionAttempt: row.missionCount, _missionCompleted: row.completedMissionCount, _missionEvent: row.missionEventCompletedCount, _freechat: row.freechatCount, _play: row.playCount, _report: reportByChild.get(row.childId) }));
    if (detailTab === "family") return families;
    if (detailTab === "parent") return parents;
    if (detailTab === "child") return children;
    return [...families, ...parents, ...children];
  }, [data, detailTab, reportByChild]);
  const detailError = detailTab === "all"
    ? [data?.errors?.families, data?.errors?.parents, data?.errors?.children].filter(Boolean).join(" / ")
    : data?.errors?.[detailTab === "family" ? "families" : detailTab === "parent" ? "parents" : "children"];

  const detailColumns = [
    { key: "type", header: "유형", render: (row: any) => row._type === "family" ? "가족" : row._type === "parent" ? "부모" : "아이" },
    { key: "name", header: "이름", render: (row: any) => <strong>{row._name}</strong> },
    { key: "last", header: "최근 활동일", render: (row: any) => date(row._last) },
    { key: "active", header: "활성 일수", render: (row: any) => row._active ?? "-" },
    { key: "missionAttempt", header: "미션 시도", render: (row: any) => row._missionAttempt ?? "-" },
    { key: "missionCompleted", header: "미션 완료", render: (row: any) => row._missionCompleted ?? "-" },
    { key: "missionEvent", header: "30일 이벤트", render: (row: any) => row._missionEvent == null ? "-" : `${row._missionEvent}/60` },
    { key: "free", header: "자유대화", render: (row: any) => row._freechat ?? "-" },
    { key: "play", header: "놀이", render: (row: any) => row._play ?? "-" },
    { key: "report", header: "리포트", render: (row: any) => row._report ? <Status value={row._report.status} /> : "-" },
    { key: "d1", header: "D1", render: (row: any) => retained(row.d1Retained) },
    { key: "d3", header: "D3", render: (row: any) => retained(row.d3Retained) },
    { key: "d7", header: "D7", render: (row: any) => retained(row.d7Retained) },
  ];

  return <AdminShell activeMenuId="analytics" onMenuChange={onMenuChange}>
    <div className="min-w-0 space-y-6 p-4 md:p-8">
      <AdminPageHeader title="통합 분석 대시보드" description="아이 활동부터 리포트 생성·부모 확인·재방문까지 KST 기준으로 한 화면에서 확인합니다. 분석 화면은 읽기 전용입니다." action={<div className="flex gap-2"><a className="inline-flex min-h-11 items-center gap-1 rounded-lg border px-3 text-sm font-bold" href={`/api/admin/analytics/export?${exportQueryString}&format=csv`}><Download size={16}/>CSV</a><a className="inline-flex min-h-11 items-center gap-1 rounded-lg border px-3 text-sm font-bold" href={`/api/admin/analytics/export?${exportQueryString}&format=xlsx`}><Download size={16}/>XLSX</a></div>} />

      <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
        <div className="flex gap-2 overflow-x-auto pb-2">{PERIODS.map(([key, label]) => <button key={key} onClick={() => setPeriod(key)} className="min-h-11 shrink-0 rounded-full border px-4 text-sm font-bold" style={{ borderColor: period === key ? "var(--admin-primary)" : "var(--admin-border)", color: period === key ? "var(--admin-primary)" : "var(--admin-text-secondary)", background: period === key ? "var(--admin-focus)" : "transparent" }}>{label}</button>)}</div>
        {period === "custom" && <div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-sm">시작일<input aria-label="시작일" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="ml-2 min-h-11 rounded-lg border px-2" /></label><label className="text-sm">종료일<input aria-label="종료일" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="ml-2 min-h-11 rounded-lg border px-2" /></label><button className="min-h-11 rounded-lg bg-[var(--admin-primary)] px-4 font-bold text-white" onClick={() => setAppliedCustom({ from: customFrom, to: customTo })}>조회</button></div>}
        <div className="mt-4 flex flex-wrap gap-3"><div role="group" aria-label="대상 범위" className="flex gap-1">{SCOPES.map(([key, label]) => <button key={key} onClick={() => setScope(key)} className="min-h-11 rounded-lg border px-3 text-sm font-bold" aria-pressed={scope === key}>{label}</button>)}</div><label className="text-sm font-bold">내부 테스트<select aria-label="내부 테스트" value={internalTest} onChange={(e) => setInternalTest(e.target.value as InternalTestMode)} className="ml-2 min-h-11 rounded-lg border px-3"><option value="exclude">제외</option><option value="include">포함</option><option value="only">테스트만</option></select></label><span className="self-center text-xs text-[var(--admin-text-secondary)]">기준 시간대 Asia/Seoul</span></div>
      </div>

      <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="분석 대상">
        {([['overview', '전체 개요'], ['children', '아이별 분석'], ['parents', '부모별 분석']] as Array<[AnalysisTab, string]>).map(([key, label]) => <button key={key} role="tab" aria-selected={analysisTab === key} className="min-h-11 shrink-0 rounded-lg border px-5 text-sm font-bold" style={{ borderColor: analysisTab === key ? "var(--admin-primary)" : "var(--admin-border)", color: analysisTab === key ? "var(--admin-primary)" : "var(--admin-text-secondary)", background: analysisTab === key ? "var(--admin-focus)" : "var(--admin-surface)" }} onClick={() => setAnalysisTab(key)}>{label}</button>)}
      </div>

      {analysisTab === "overview" ? (error ? <AdminErrorState error={error} onRetry={() => setReload((value) => value + 1)} /> : !data ? <div className="rounded-2xl border p-12 text-center text-[var(--admin-text-secondary)]">통합 지표를 불러오는 중입니다.</div> : <>
        <div id="kpi"><AdminKpiGrid>{kpis.map((kpi) => <button key={kpi.key} className="text-left" onClick={() => document.getElementById(kpi.key.startsWith("d") ? "retention" : kpi.key.includes("report") || kpi.key.includes("mission") ? "funnel" : "dau")?.scrollIntoView({ behavior: "smooth" })}><AdminKpiCard title={kpi.label} value={kpi.unit === "percent" ? percent(kpi.value) : (kpi.value ?? "-").toLocaleString()} description={kpi.denominator == null ? undefined : `완료 ${kpi.numerator ?? 0} / 대상 ${kpi.denominator}`} /></button>)}</AdminKpiGrid></div>

        <Section id="funnel" title="행동 퍼널 / 리포트 생성 흐름" description="각 단계는 현재 기간·대상·내부 테스트 필터를 공유합니다.">
          {data.errors?.reporting ? <AdminErrorState error={data.errors.reporting} onRetry={() => setReload((value) => value + 1)} /> : <div className="space-y-3">{funnel.map((row) => <div key={row.key} className="grid gap-2 md:grid-cols-[180px_1fr_220px] md:items-center"><strong className="text-sm">{row.label}</strong><div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[var(--admin-primary)]" style={{ width: `${Math.min(100, row.completionRate ?? 0)}%` }} /></div><div className="text-sm text-[var(--admin-text-secondary)]">완료 {row.completed} / 대상 {row.target} · 실패 {row.failed} · {percent(row.completionRate)}</div></div>)}</div>}
        </Section>

        <div className="grid gap-6 xl:grid-cols-2">
          <Section id="dau" title="일별 활성 사용자 추이 (DAU)" description="DAU는 선택 기간의 실제 활동이며, 리텐션은 완료된 코호트만 계산합니다.">
            <div className="mb-2 flex flex-wrap gap-3 text-sm">{[["parent", "부모 활성"], ["child", "아이 활성"], ["total", "전체 활성"]].map(([key, label]) => <label key={key}><input type="checkbox" checked={series[key as keyof typeof series]} onChange={(e) => setSeries((prev) => ({ ...prev, [key]: e.target.checked }))} /> {label}</label>)}</div>
            {data.errors?.overview ? <AdminErrorState error={data.errors.overview} onRetry={() => setReload((value) => value + 1)} /> : daily.length === 0 ? <p className="py-12 text-center text-sm text-[var(--admin-text-secondary)]">기간 내 활성 데이터가 없습니다.</p> : <div className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={daily}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="date" tick={{ fontSize: 11 }}/><YAxis allowDecimals={false}/><Tooltip/><Legend/>{series.parent && <Line type="monotone" dataKey="activeParents" name="부모 활성" stroke="#7c3aed" strokeWidth={2}/>} {series.child && <Line type="monotone" dataKey="activeChildren" name="아이 활성" stroke="#0891b2" strokeWidth={2}/>} {series.total && <Line type="monotone" dataKey="totalActive" name="전체 활성" stroke="#ea580c" strokeWidth={2}/>}</LineChart></ResponsiveContainer></div>}
          </Section>

          <Section id="retention" title="가입 코호트 리텐션" description="아직 도래하지 않은 D1·D3·D7·D14·W2는 0%가 아닌 '-'로 표시합니다.">
            {data.errors?.cohort ? <AdminErrorState error={data.errors.cohort} onRetry={() => setReload((value) => value + 1)} /> : <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b text-left"><th className="p-2">가입 주차</th><th className="p-2">모수</th>{["D1", "D3", "D7", "D14", "W2"].map((label) => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{cohorts.map((row) => <tr key={row.cohortWeekStart} className="border-b"><td className="p-2 font-bold">{row.cohortLabel}</td><td className="p-2">{row.size || "-"}</td>{["d1", "d3", "d7", "d14", "w2"].map((key) => <td key={key} className="p-2" style={{ background: row[key]?.rate == null ? undefined : `rgba(8,145,178,${0.08 + row[key].rate * 0.32})` }}>{row[key]?.rate == null ? "-" : percent(row[key].rate * 100)}</td>)}</tr>)}</tbody></table>{cohorts.length === 0 && <p className="py-12 text-center text-[var(--admin-text-secondary)]">완료된 코호트가 없습니다.</p>}</div>}
          </Section>
        </div>

        <Section title="리포팅 품질 현황" description="실패 > 대기 > 성공 우선순위로 판정합니다.">
          <div className="mb-4 flex items-center gap-2"><label className="text-sm font-bold">상태<select aria-label="리포팅 상태" value={reportStatus} onChange={(e) => setReportStatus(e.target.value)} className="ml-2 min-h-11 rounded-lg border px-3"><option value="all">전체</option><option value="success">성공</option><option value="failure">실패</option><option value="pending">대기</option></select></label><span className="text-xs text-[var(--admin-text-secondary)]">조회 원천: pipeline_jobs · raw/corrected V3 · daily_reports</span></div>
          {data.errors?.reporting ? <AdminErrorState error={data.errors.reporting} onRetry={() => setReload((value) => value + 1)} /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">{quality.map((row) => <div key={row.key} className="rounded-xl border p-4"><strong>{row.label}</strong><div className="mt-3 text-2xl font-black">{percent(row.successRate)}</div><div className="mt-2 text-xs text-[var(--admin-text-secondary)]">대상 {row.target} · 성공 {row.success} · 실패 {row.failure} · 대기 {row.pending}</div></div>)}</div>}
        </Section>

        <Section title="상세 드릴다운" description="행을 선택하면 최근 활동·서비스 이용·리포트·리텐션 상태를 확인할 수 있습니다.">
          <div className="mb-4 flex gap-1 overflow-x-auto" role="tablist">{SCOPES.map(([key, label]) => <button role="tab" aria-selected={detailTab === key} key={key} onClick={() => setDetailTab(key)} className="min-h-11 shrink-0 rounded-lg border px-4 text-sm font-bold">{label}</button>)}</div>
          <AdminResponsiveTable mobileStrategy="card" data={detailRows} columns={detailColumns} keyExtractor={(row) => row._key} onRowClick={setSelected} error={detailError || undefined} onRetry={() => setReload((value) => value + 1)} emptyMessage="현재 필터에 해당하는 상세 사용자가 없습니다." />
        </Section>
      </>) : <RetentionPeopleTabs key={analysisTab} tab={analysisTab} queryString={queryString} onQueryChange={setPeopleQuery} />}
    </div>

    {selected && <div className="fixed inset-0 z-[80] flex justify-end bg-black/40" onClick={() => setSelected(null)}><aside role="dialog" aria-modal="true" aria-label="분석 상세" className="h-full w-full overflow-y-auto bg-white p-6 shadow-2xl sm:max-w-lg" onClick={(e) => e.stopPropagation()}><button className="float-right min-h-11 min-w-11" aria-label="상세 닫기" onClick={() => setSelected(null)}><X/></button><h2 className="mb-6 text-xl font-black">{selected._name}</h2><dl className="grid grid-cols-2 gap-4 text-sm"><dt>유형</dt><dd>{selected._type}</dd><dt>최근 활동</dt><dd>{date(selected._last)}</dd><dt>활성 일수</dt><dd>{selected._active ?? "-"}</dd><dt>미션 / 자유대화 / 놀이</dt><dd>{selected._mission ?? "-"} / {selected._freechat ?? "-"} / {selected._play ?? "-"}</dd><dt>리포트</dt><dd>{selected._report ? <Status value={selected._report.status}/> : "-"}</dd><dt>D1 / D3 / D7</dt><dd>{retained(selected.d1Retained)} / {retained(selected.d3Retained)} / {retained(selected.d7Retained)}</dd></dl><a className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-[var(--admin-primary)] px-4 font-bold text-white" href={`/admin/users?tab=${selected._type === "child" ? "children" : selected._type === "parent" ? "parents" : "families"}&search=${encodeURIComponent(selected._name || "")}`}>사용자 관리에서 보기</a></aside></div>}
  </AdminShell>;
}

export default function AdminAnalyticsPage() {
  return <Suspense fallback={<div className="p-12 text-center text-[var(--admin-text-secondary)]">통합 분석 대시보드를 준비하는 중입니다.</div>}><AdminAnalyticsContent /></Suspense>;
}
