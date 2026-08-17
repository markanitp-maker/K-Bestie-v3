"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { AdminErrorState } from "@/components/admin/shell/AdminErrorState";
import { AdminResponsiveTable } from "@/components/admin/shell/AdminResponsiveTable";
import type {
  ChildAnalyticsRow,
  ChildUsageStatus,
  ParentAnalyticsRow,
  ParentUsageStatus,
  RetentionResult,
} from "@/lib/admin/retentionPeopleAnalytics";

type PeopleTab = "children" | "parents";
type FamilyOption = { id: string; name: string };
type PagePayload<T> = {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  options: { grades?: string[]; families: FamilyOption[] };
  statusSummary: Record<string, number>;
  meta: { reportViewIdentity?: "family" | "individual"; reportViewIdentityReason?: string };
};

const CHILD_STATUS_LABELS: Record<ChildUsageStatus, string> = {
  initial: "초기 사용자",
  healthy: "정상 사용",
  low_usage: "사용 저조",
  churn_risk: "이탈 위험",
  parent_unread: "부모 미열람",
};
const PARENT_STATUS_LABELS: Record<ParentUsageStatus, string> = {
  active: "활성 부모",
  low_engagement: "낮은 참여",
  report_unread: "리포트 미열람",
};
const STATUS_COLORS: Record<ChildUsageStatus | ParentUsageStatus, string> = {
  initial: "#2563eb",
  healthy: "#047857",
  low_usage: "#a16207",
  churn_risk: "#b91c1c",
  parent_unread: "#c2410c",
  active: "#047857",
  low_engagement: "#a16207",
  report_unread: "#b91c1c",
};

function formatDate(value: string | null): string {
  return value ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)) : "-";
}

function rate(value: number | null): string {
  return value == null ? "-" : `${value.toFixed(1)}%`;
}

function retention(value: RetentionResult): string {
  return value == null ? "-" : value ? "O" : "X";
}

function StatusPills<T extends ChildUsageStatus | ParentUsageStatus>({ statuses, labels }: { statuses: T[]; labels: Record<T, string> }) {
  return <div className="flex flex-wrap gap-1">{statuses.map((status) => <span key={status} className="rounded-full px-2 py-1 text-xs font-bold" style={{ color: STATUS_COLORS[status], background: `${STATUS_COLORS[status]}18` }}>{labels[status]}</span>)}</div>;
}

function Pager({ page, totalPages, total, pageSize, onPage, onPageSize }: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
    <span>총 {total.toLocaleString()}명 · {page}/{totalPages}페이지</span>
    <div className="flex items-center gap-2">
      <label>페이지 크기 <select className="min-h-10 rounded-lg border px-2" value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>{[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
      <button className="min-h-10 rounded-lg border px-3 disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)}>이전</button>
      <button className="min-h-10 rounded-lg border px-3 disabled:opacity-40" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>다음</button>
    </div>
  </div>;
}

export function RetentionPeopleTabs({ tab, queryString, onQueryChange }: { tab: PeopleTab; queryString: string; onQueryChange: (query: string) => void }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState("all");
  const [grade, setGrade] = useState("all");
  const [familyId, setFamilyId] = useState("all");
  const [d1, setD1] = useState("all");
  const [d7, setD7] = useState("all");
  const [sort, setSort] = useState(tab === "children" ? "last_oldest" : "report_rate_low");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [payload, setPayload] = useState<PagePayload<ChildAnalyticsRow | ParentAnalyticsRow> | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [selectedParent, setSelectedParent] = useState<ParentAnalyticsRow | null>(null);

  const requestQuery = useMemo(() => {
    const params = new URLSearchParams(queryString);
    params.set("search", deferredSearch);
    params.set("status", status);
    params.set("familyId", familyId);
    params.set("sort", sort);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    if (tab === "children") {
      params.set("grade", grade);
      params.set("d1", d1);
      params.set("d7", d7);
    }
    return params.toString();
  }, [queryString, deferredSearch, status, familyId, sort, page, pageSize, tab, grade, d1, d7]);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetch(`/api/admin/analytics/${tab}?${requestQuery}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "분석 데이터를 불러오지 못했습니다.");
        setPayload(body as PagePayload<ChildAnalyticsRow | ParentAnalyticsRow>);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "분석 데이터를 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, [tab, requestQuery, reload]);

  useEffect(() => onQueryChange(requestQuery), [onQueryChange, requestQuery]);

  const resetPage = () => setPage(1);
  const families = payload?.options.families ?? [];
  const grades = payload?.options.grades ?? [];
  const childRows = tab === "children" ? (payload?.rows ?? []) as ChildAnalyticsRow[] : [];
  const parentRows = tab === "parents" ? (payload?.rows ?? []) as ParentAnalyticsRow[] : [];
  const childColumns = [
    { key: "child", header: "아이", render: (row: ChildAnalyticsRow) => <div><strong>{row.childName}</strong><div className="text-xs text-[var(--admin-text-secondary)]">{row.loginId || "로그인 ID 없음"} · {row.grade}</div></div> },
    { key: "family", header: "가족 / 부모", render: (row: ChildAnalyticsRow) => <div>{row.familyName}<div className="text-xs text-[var(--admin-text-secondary)]">{row.parentNames.join(", ") || "연결 부모 없음"}</div></div> },
    { key: "usage", header: "최근 사용", render: (row: ChildAnalyticsRow) => <div>{formatDate(row.lastActivityAt)}<div className="text-xs text-[var(--admin-text-secondary)]">7일 {row.activeDaysLast7}일 · 30일 {row.activeDaysLast30}일 · 연속 {row.streakDays}일</div></div> },
    { key: "retention", header: "D1 / D3 / D7 / W2", render: (row: ChildAnalyticsRow) => `${retention(row.d1)} / ${retention(row.d3)} / ${retention(row.d7)} / ${retention(row.w2)}` },
    { key: "behavior", header: "미션 / 자유대화 / 놀이", render: (row: ChildAnalyticsRow) => <div>{row.missionCompletedCount}/{row.missionCount} · {rate(row.missionCompletionRate)}<div className="text-xs text-[var(--admin-text-secondary)]">자유대화 {row.freechatCount} · 놀이 {row.playCount}</div></div> },
    { key: "parent", header: "리포트 / 질문", render: (row: ChildAnalyticsRow) => <div>{row.reportViewedCount}/{row.reportGeneratedCount} · {rate(row.reportViewRate)}<div className="text-xs text-[var(--admin-text-secondary)]">질문 {row.parentQuestionCount} · 전달 {row.parentQuestionDeliveredCount}</div></div> },
    { key: "status", header: "상태", render: (row: ChildAnalyticsRow) => <StatusPills statuses={row.statuses} labels={CHILD_STATUS_LABELS} /> },
  ];
  const parentColumns = [
    { key: "parent", header: "부모", render: (row: ParentAnalyticsRow) => <div><strong>{row.parentName}</strong><div className="text-xs text-[var(--admin-text-secondary)]">{row.email || "이메일 없음"}</div></div> },
    { key: "family", header: "가족", render: (row: ParentAnalyticsRow) => row.familyName },
    { key: "children", header: "연결 아이", render: (row: ParentAnalyticsRow) => <div>{row.children.map((child) => child.childName).join(", ") || "-"}<div className="text-xs text-[var(--admin-text-secondary)]">정상 {row.children.filter((child) => child.statuses.includes("healthy")).length} · 위험 {row.children.filter((child) => child.statuses.includes("churn_risk")).length}</div></div> },
    { key: "reports", header: "가족 리포트", render: (row: ParentAnalyticsRow) => <div>{row.reportViewedCount}/{row.reportGeneratedCount} · {rate(row.reportViewRate)}<div className="text-xs text-[var(--admin-text-secondary)]">최근 열람 {formatDate(row.latestReportViewedAt)}</div></div> },
    { key: "questions", header: "부모 질문", render: (row: ParentAnalyticsRow) => `${row.parentQuestionCount}건 · 전달 ${row.parentQuestionDeliveredCount}건` },
    { key: "status", header: "상태", render: (row: ParentAnalyticsRow) => <StatusPills statuses={row.statuses} labels={PARENT_STATUS_LABELS} /> },
  ];

  return <section className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 md:p-6">
    <div className="mb-4">
      <h2 className="m-0 text-lg font-bold">{tab === "children" ? "아이별 분석" : "부모별 분석"}</h2>
      <p className="mt-1 text-sm text-[var(--admin-text-secondary)]">{tab === "children" ? "아이의 실제 사용과 부모 연계를 함께 확인합니다." : "아이 사용 → 리포트 생성 → 가족 열람 → 부모 질문 흐름을 확인합니다."}</p>
    </div>

    <div className="mb-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
      <label className="text-sm font-bold">검색<input className="mt-1 min-h-11 w-full rounded-lg border px-3 font-normal" value={search} onChange={(event) => { setSearch(event.target.value); resetPage(); }} placeholder={tab === "children" ? "아이·로그인 ID·가족·부모" : "부모·이메일·가족·아이"} /></label>
      <label className="text-sm font-bold">가족<select className="mt-1 min-h-11 w-full rounded-lg border px-3 font-normal" value={familyId} onChange={(event) => { setFamilyId(event.target.value); resetPage(); }}><option value="all">전체</option>{families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}</select></label>
      {tab === "children" && <label className="text-sm font-bold">학년<select className="mt-1 min-h-11 w-full rounded-lg border px-3 font-normal" value={grade} onChange={(event) => { setGrade(event.target.value); resetPage(); }}><option value="all">전체</option>{grades.map((item) => <option key={item}>{item}</option>)}</select></label>}
      <label className="text-sm font-bold">정렬<select className="mt-1 min-h-11 w-full rounded-lg border px-3 font-normal" value={sort} onChange={(event) => { setSort(event.target.value); resetPage(); }}>{tab === "children" ? <><option value="last_oldest">최근 사용 오래된 순</option><option value="last_newest">최근 사용 최신 순</option><option value="active7_low">7일 활성 낮은 순</option><option value="d7_failure">D7 실패 우선</option><option value="mission_rate_low">미션 완료율 낮은 순</option><option value="report_rate_low">부모 열람률 낮은 순</option></> : <><option value="report_rate_low">리포트 열람률 낮은 순</option><option value="report_rate_high">리포트 열람률 높은 순</option><option value="recent_view_oldest">최근 열람 오래된 순</option><option value="recent_view_newest">최근 열람 최신 순</option></>}</select></label>
    </div>

    <div className="mb-4 flex flex-wrap gap-2">
      <button className="min-h-10 rounded-full border px-3 text-sm font-bold" aria-pressed={status === "all"} onClick={() => { setStatus("all"); resetPage(); }}>전체 {payload?.total ?? 0}</button>
      {(tab === "children" ? Object.entries(CHILD_STATUS_LABELS) : Object.entries(PARENT_STATUS_LABELS)).map(([key, label]) => <button key={key} className="min-h-10 rounded-full border px-3 text-sm font-bold" aria-pressed={status === key} onClick={() => { setStatus(key); resetPage(); }}>{label} {payload?.statusSummary[key] ?? 0}</button>)}
      {tab === "children" && <><select aria-label="D1 필터" className="min-h-10 rounded-full border px-3 text-sm" value={d1} onChange={(event) => { setD1(event.target.value); resetPage(); }}><option value="all">D1 전체</option><option value="success">D1 성공</option><option value="failure">D1 실패</option><option value="pending">D1 대기</option></select><select aria-label="D7 필터" className="min-h-10 rounded-full border px-3 text-sm" value={d7} onChange={(event) => { setD7(event.target.value); resetPage(); }}><option value="all">D7 전체</option><option value="success">D7 성공</option><option value="failure">D7 실패</option><option value="pending">D7 대기</option></select></>}
    </div>

    {tab === "parents" && payload?.meta.reportViewIdentityReason && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{payload.meta.reportViewIdentityReason}</p>}
    {error ? <AdminErrorState error={error} onRetry={() => setReload((value) => value + 1)} /> : !payload ? <div className="py-16 text-center text-[var(--admin-text-secondary)]">분석 데이터를 불러오는 중입니다.</div> : tab === "children" ? <AdminResponsiveTable<ChildAnalyticsRow> mobileStrategy="scroll" data={childRows} columns={childColumns} keyExtractor={(row) => row.childId} onRowClick={(row) => router.push(`/admin/retention/children/${row.childId}`)} emptyMessage="조건에 해당하는 아이가 없습니다." /> : <AdminResponsiveTable<ParentAnalyticsRow> mobileStrategy="scroll" data={parentRows} columns={parentColumns} keyExtractor={(row) => row.parentId} onRowClick={setSelectedParent} emptyMessage="조건에 해당하는 부모가 없습니다." />}
    {payload && <Pager page={payload.page} totalPages={payload.totalPages} total={payload.total} pageSize={payload.pageSize} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} />}

    {selectedParent && <div className="fixed inset-0 z-[90] flex justify-end bg-black/40" onClick={() => setSelectedParent(null)}><aside role="dialog" aria-modal="true" aria-label="부모 분석 상세" className="h-full w-full overflow-y-auto bg-white p-6 shadow-2xl sm:max-w-xl" onClick={(event) => event.stopPropagation()}><button className="float-right min-h-11 min-w-11" aria-label="상세 닫기" onClick={() => setSelectedParent(null)}><X /></button><h2 className="mb-1 text-xl font-black">{selectedParent.parentName}</h2><p className="mb-6 text-sm text-[var(--admin-text-secondary)]">{selectedParent.email || "이메일 없음"} · {selectedParent.familyName}</p><dl className="grid grid-cols-2 gap-4 text-sm"><dt>가족 리포트 생성</dt><dd>{selectedParent.reportGeneratedCount}건</dd><dt>가족 리포트 열람</dt><dd>{selectedParent.reportViewedCount}건 · {rate(selectedParent.reportViewRate)}</dd><dt>부모 질문</dt><dd>{selectedParent.parentQuestionCount}건 · 전달 {selectedParent.parentQuestionDeliveredCount}건</dd></dl><h3 className="mb-3 mt-8 font-bold">연결 아이</h3><div className="space-y-2">{selectedParent.children.map((child) => <button key={child.childId} className="flex min-h-11 w-full items-center justify-between rounded-lg border px-3 text-left" onClick={() => router.push(`/admin/retention/children/${child.childId}`)}><span className="font-bold">{child.childName}</span><span className="text-sm">최근 7일 {child.activeDaysLast7}일 · D7 {retention(child.d7)}</span></button>)}</div></aside></div>}
  </section>;
}
