"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PlanChangeRequestsTab from "../(dashboard)/PlanChangeRequestsTab";
import { AdminShell, type AdminPageId } from "@/components/admin/shell/AdminShell";
import { AdminPageHeader } from "@/components/admin/shell/AdminPageHeader";
import { AdminResponsiveTable } from "@/components/admin/shell/AdminResponsiveTable";
import { AdminStatusBadge } from "@/components/admin/shell/AdminStatusBadge";
import {
  asArray,
  parseAdminUsersOverviewResponse,
  type AdminUsersOverviewResponse,
} from "@/lib/admin/userManagement";

type Tab = "families" | "parents" | "children";
type SubTab = "all" | "restorations" | "plan-change" | "approval";
type Row = Record<string, any> & {
  alreadyResolved?: boolean;
};

const TAB_LABELS: Record<Tab, string> = { families: "가족", parents: "부모", children: "아이" };

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(date);
}

function genderLabel(value: string | null | undefined): string {
  const normalized = value?.toLowerCase();
  if (normalized === "m" || normalized === "male") return "남";
  if (normalized === "f" || normalized === "female") return "여";
  return "미등록";
}

function statusVariant(status: string): "success" | "warning" | "danger" | "neutral" {
  if (["활성", "ACTIVE", "등록 완료", "approved"].includes(status)) return "success";
  if (["ONBOARDING", "pending", "승인 대기"].includes(status)) return "warning";
  if (["SUSPENDED", "rejected", "creation_failed"].includes(status)) return "danger";
  return "neutral";
}

function ChildUsageSummary({ childId }: { childId: string }) {
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    setSummary(null);
    try {
      const response = await fetch(`/api/admin/usage?childId=${encodeURIComponent(childId)}`);
      if (!response.ok) throw new Error("usage summary failed");
      const payload = await response.json();
      if (!payload?.summary || typeof payload.summary !== "object") throw new Error("invalid usage summary");
      setSummary(payload.summary);
    } catch {
      setFailed(true);
    }
  }, [childId]);
  useEffect(() => { load(); }, [load]);

  if (failed) return <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">사용량 요약을 불러오지 못했습니다.<button type="button" onClick={load} className="ml-2 font-bold underline">다시 시도</button></div>;
  if (!summary) return <div className="mt-5 rounded-xl border border-gray-200 p-4 text-sm text-gray-500">사용량 요약 불러오는 중...</div>;
  return <section className="mt-5"><h3 className="mb-2 font-bold">usage_events 요약</h3><div className="grid grid-cols-2 gap-2 text-sm">{[["STT", summary.stt], ["TTS", summary.tts], ["Live", summary.live_audio], ["LLM", summary.llm]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-gray-200 p-3"><span className="text-gray-500">{label}</span><b className="ml-2">{Number(value ?? 0)}건</b></div>)}</div></section>;
}

function DetailDrawer({ row, tab, onClose, onNavigate }: { row: Row; tab: Tab; onClose: () => void; onNavigate: (tab: Tab, search: string) => void }) {
  const fields = tab === "families"
    ? [
        ["가족명", row.name], ["상태", row.status], ["생성일", formatDate(row.createdAt)], ["최근 활동", formatDate(row.lastActivityAt)], ["테스트", row.testLabel], ["요금제", asArray<string>(row.planNames).join(" / ") || "-"],
      ]
    : tab === "parents"
      ? [
          ["부모", row.name], ["로그인 이메일", row.email || "-"], ["계정 상태", row.status], ["가입일", formatDate(row.createdAt)], ["최근 접속", formatDate(row.lastSignInAt)], ["온보딩 완료", formatDate(row.onboardingCompletedAt)], ["가족", row.familyName], ["요금제", row.planName], ["가입 채널", row.channel], ["테스트", row.isTest ? "테스트" : "일반"],
        ]
      : [
          ["아이", row.name], ["로그인 아이디", row.loginId || "-"], ["학년", row.grade], ["성별", genderLabel(row.gender)], ["가족", row.familyName], ["연결 부모", asArray<string>(row.parents).join(" / ") || "-"], ["승인", row.approval], ["요금제", row.planName], ["생성일", formatDate(row.createdAt)], ["최근 활동", formatDate(row.lastActivityAt)], ["최근 미션", `${row.sessionCounts?.mission ?? 0}회`], ["최근 자유대화", `${row.sessionCounts?.freechat ?? 0}회`], ["테스트", row.isTest ? "테스트" : "일반"],
        ];

  return (
    <div role="dialog" aria-modal="true" aria-label={`${TAB_LABELS[tab]} 상세`} className="fixed inset-0 z-[200] bg-black/30" onClick={onClose}>
      <aside className="absolute right-0 top-0 h-full w-full max-w-[520px] overflow-y-auto bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-6 flex items-center justify-between gap-4">
          <div><p className="text-xs font-semibold text-gray-500">{TAB_LABELS[tab]} 상세</p><h2 className="text-xl font-bold text-gray-900">{row.name}</h2></div>
          <button type="button" onClick={onClose} aria-label="상세 닫기" className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold">닫기</button>
        </div>
        <dl className="divide-y divide-gray-100 rounded-xl border border-gray-200">
          {fields.map(([label, value]) => <div key={label} className="grid grid-cols-[120px_1fr] gap-3 px-4 py-3"><dt className="text-sm text-gray-500">{label}</dt><dd className="min-w-0 break-words text-sm font-medium text-gray-900">{value}</dd></div>)}
        </dl>
        {tab === "families" && <div className="mt-5 space-y-4">
          <section><h3 className="mb-2 font-bold">부모</h3>{asArray<Row>(row.parents).map((parent) => <button key={parent.id} className="mb-2 block w-full rounded-lg border p-3 text-left" onClick={() => onNavigate("parents", parent.email || parent.name)}><b>{parent.name}</b><span className="block truncate text-xs text-gray-500">{parent.email} · {parent.role} · {parent.status}</span></button>)}</section>
          <section><h3 className="mb-2 font-bold">아이</h3>{asArray<Row>(row.children).map((child) => <button key={child.id} className="mb-2 block w-full rounded-lg border p-3 text-left" onClick={() => onNavigate("children", child.loginId || child.name)}><b>{child.name}</b><span className="block text-xs text-gray-500">{child.loginId || "아이디 미등록"} · {child.grade || "학년 미등록"}</span></button>)}</section>
        </div>}
        {tab === "parents" && asArray<Row>(row.children).length > 0 && <button className="mt-5 w-full rounded-lg bg-slate-900 px-4 py-3 font-bold text-white" onClick={() => onNavigate("children", asArray<Row>(row.children)[0].name)}>연결 아이 보기</button>}
        {tab === "children" && <button className="mt-5 w-full rounded-lg bg-slate-900 px-4 py-3 font-bold text-white" onClick={() => onNavigate("families", row.familyName)}>가족 보기</button>}
        {tab === "children" && <ChildUsageSummary childId={row.id} />}
      </aside>
    </div>
  );
}

function ExistingRequestPanel({ kind }: { kind: "restorations" | "approval" }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const endpoint = kind === "restorations" ? "/api/admin/account-restore-requests" : "/api/admin/child-approval-requests";
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error("처리 요청 조회 실패");
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("처리 요청 응답 형식 오류");
      setRows(data);
    } catch {
      setRows([]);
      setError("처리 요청을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [endpoint]);
  useEffect(() => { load(); }, [load]);

  const act = async (row: Row, action: "approve" | "reject") => {
    if (action === "approve" && !window.confirm("승인 처리할까요?")) return;
    const reason = action === "reject" ? window.prompt("거절 사유를 입력하세요 (선택):") : "";
    if (action === "reject" && reason === null) return;
    if (kind === "approval" && action === "approve" && (!row.beta_verified || !row.survey_verified)) { window.alert("기존 정책에 따라 베타·설문 확인이 완료된 요청만 승인할 수 있습니다."); return; }
    setBusy(row.id);
    const url = kind === "restorations" ? `/api/admin/account-restore-requests/${row.id}/${action}` : `/api/admin/child-approval-requests/${row.id}/${action}`;
    const body = action === "reject" ? { reason } : kind === "approval" ? { betaVerified: true, surveyVerified: true } : {};
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) window.alert((await response.json().catch(() => ({}))).error || "처리하지 못했습니다.");
    setBusy(null); load();
  };

  const visible = kind === "approval" ? rows.filter((row) => ["pending", "creation_failed", "PENDING_PAYMENT"].includes(row.status) && !row.alreadyResolved) : rows;
  return <AdminResponsiveTable mobileStrategy="card" columns={kind === "restorations" ? [
    { key: "name", header: "부모", render: (row: Row) => <><b>{row.name || "이름 미등록"}</b><span className="block text-xs text-gray-500">{row.email}</span></> },
    { key: "family", header: "가족", render: (row: Row) => row.memberships?.map((membership: Row) => membership.families?.name || "이름 없는 가족").join(" / ") || "-" },
    { key: "requested", header: "요청일", render: (row: Row) => formatDate(row.restore_requested_at) },
    { key: "action", header: "액션", render: (row: Row) => <div className="flex gap-2"><button disabled={busy === row.id} onClick={() => act(row, "reject")} className="rounded border border-red-500 px-3 py-2 text-xs font-bold text-red-600">거절</button><button disabled={busy === row.id} onClick={() => act(row, "approve")} className="rounded bg-slate-900 px-3 py-2 text-xs font-bold text-white">승인</button></div> },
  ] : [
    { key: "child", header: "아이", render: (row: Row) => <><b>{`${row.family_name || ""}${row.given_name || ""}` || "이름 미등록"}</b><span className="block text-xs text-gray-500">{row.username}</span></> },
    { key: "family", header: "가족·부모", render: (row: Row) => <>{row.family_name || "-"}<span className="block text-xs text-gray-500">{row.requester_email}</span></> },
    { key: "grade", header: "학년", render: (row: Row) => row.grade || "-" },
    { key: "status", header: "상태", render: (row: Row) => <AdminStatusBadge text={row.status} variant={statusVariant(row.status)} /> },
    { key: "requested", header: "요청일", render: (row: Row) => formatDate(row.requested_at) },
    { key: "action", header: "액션", render: (row: Row) => <div className="flex gap-2"><button disabled={busy === row.id} onClick={() => act(row, "reject")} className="rounded border border-red-500 px-3 py-2 text-xs font-bold text-red-600">거절</button><button disabled={busy === row.id || !row.beta_verified || !row.survey_verified} onClick={() => act(row, "approve")} className="rounded bg-slate-900 px-3 py-2 text-xs font-bold text-white">승인</button></div> },
  ]} data={visible} isLoading={loading} error={error} onRetry={load} keyExtractor={(row) => row.id} emptyMessage="처리 대기 요청이 없습니다." />;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("families");
  const [sub, setSub] = useState<SubTab>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [internalTest, setInternalTest] = useState("exclude");
  const [status, setStatus] = useState("all");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [sort, setSort] = useState("created_desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<AdminUsersOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextTab = params.get("tab");
    const nextSub = params.get("sub");
    const nextSearch = params.get("search")?.trim();
    if (nextTab === "parents" || nextTab === "children" || nextTab === "families") setTab(nextTab);
    if (["restorations", "plan-change", "approval"].includes(nextSub || "")) setSub(nextSub as SubTab);
    if (nextSearch) { setSearch(nextSearch); setDebouncedSearch(nextSearch); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300); return () => window.clearTimeout(timer); }, [search]);

  const query = useMemo(() => new URLSearchParams({ tab, search: debouncedSearch, internalTest, status, createdFrom, createdTo, page: String(page), pageSize: String(pageSize), sort }), [tab, debouncedSearch, internalTest, status, createdFrom, createdTo, page, pageSize, sort]);
  const load = useCallback(async () => {
    const requestId = ++requestSequence.current;
    if (sub !== "all") return;
    setLoading(true);
    setError("");
    setData(null);
    try {
      const response = await fetch(`/api/admin/users/overview?${query}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "사용자 정보를 불러오지 못했습니다.");
      if (requestId === requestSequence.current) setData(parseAdminUsersOverviewResponse(payload));
    } catch (reason) {
      if (requestId === requestSequence.current) setError(reason instanceof Error ? reason.message : "사용자 정보를 불러오지 못했습니다.");
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [query, sub]);
  useEffect(() => { load(); }, [load]);

  const changeTab = (next: Tab) => { setTab(next); setSub("all"); setStatus("all"); setPage(1); setSelected(null); history.replaceState(null, "", `/admin/users?tab=${next}`); };
  const changeSub = (next: SubTab) => { setSub(next); setSelected(null); history.replaceState(null, "", `/admin/users?tab=${tab}${next === "all" ? "" : `&sub=${next}`}`); };
  const navigateFromDrawer = (next: Tab, value: string) => { changeTab(next); setSearch(value); setDebouncedSearch(value); setSelected(null); };
  const onMenuChange = (id: AdminPageId) => { if (id !== "users") router.push(`/admin?menu=${id}`); };

  const columns = tab === "families" ? [
    { key: "name", header: "가족", render: (row: Row) => <b>{row.name}</b> },
    { key: "parents", header: "부모", render: (row: Row) => asArray<Row>(row.parents).slice(0, 2).map((parent) => <div key={parent.id}>{parent.name}<span className="block max-w-48 truncate text-xs text-gray-500">{parent.email}</span></div>) },
    { key: "children", header: "아이", render: (row: Row) => asArray<Row>(row.children).map((child) => child.name).join(", ") || "-" },
    { key: "plan", header: "요금제", render: (row: Row) => asArray<string>(row.planNames).join(" / ") || "-" },
    { key: "created", header: "생성일", render: (row: Row) => formatDate(row.createdAt) },
    { key: "activity", header: "최근 활동", render: (row: Row) => formatDate(row.lastActivityAt) },
    { key: "test", header: "테스트", render: (row: Row) => row.testLabel },
    { key: "status", header: "상태", render: (row: Row) => <AdminStatusBadge text={row.status} variant="success" /> },
  ] : tab === "parents" ? [
    { key: "name", header: "부모", render: (row: Row) => <><b>{row.name}</b><span className="block max-w-56 truncate text-xs text-gray-500" title={row.email}>{row.email}</span></> },
    { key: "family", header: "가족", render: (row: Row) => row.familyName },
    { key: "children", header: "연결 아이", render: (row: Row) => `${row.childCount}명` },
    { key: "plan", header: "요금제", render: (row: Row) => row.planName },
    { key: "channel", header: "가입 채널", render: (row: Row) => row.channel },
    { key: "created", header: "가입일", render: (row: Row) => formatDate(row.createdAt) },
    { key: "signin", header: "최근 접속", render: (row: Row) => <span title="Supabase Auth 기준 최근 로그인/토큰 갱신 시각">{formatDate(row.lastSignInAt)}</span> },
    { key: "status", header: "상태", render: (row: Row) => <AdminStatusBadge text={row.status} variant={statusVariant(row.status)} /> },
    { key: "test", header: "테스트", render: (row: Row) => row.isTest ? "테스트" : "일반" },
  ] : [
    { key: "name", header: "아이", render: (row: Row) => <><b>{row.name}</b><span className="block text-xs text-gray-500">{row.loginId}</span></> },
    { key: "grade", header: "학년", render: (row: Row) => row.grade },
    { key: "gender", header: "성별", render: (row: Row) => genderLabel(row.gender) },
    { key: "family", header: "가족", render: (row: Row) => row.familyName },
    { key: "parents", header: "부모", render: (row: Row) => asArray<string>(row.parents).join(" / ") || "-" },
    { key: "approval", header: "승인", render: (row: Row) => <AdminStatusBadge text={row.approval} variant="success" /> },
    { key: "created", header: "생성일", render: (row: Row) => formatDate(row.createdAt) },
    { key: "activity", header: "최근 활동", render: (row: Row) => formatDate(row.lastActivityAt) },
    { key: "test", header: "테스트", render: (row: Row) => row.isTest ? "테스트" : "일반" },
  ];

  const subTabs = tab === "parents" ? [["all", "전체 부모"], ["restorations", "계정 복구 요청"], ["plan-change", "요금제 변경 요청"]] : tab === "children" ? [["all", "전체 아이"], ["approval", "승인 대기"]] : [];

  return <AdminShell activeMenuId="users" onMenuChange={onMenuChange}>
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader title="사용자 관리" description="가족·부모·아이 계정과 서비스 이용 상태를 관리합니다." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["전체 가족", data?.counts.families], ["전체 부모", data?.counts.parents], ["전체 아이", data?.counts.children], ["처리 대기", data?.counts.pending]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-gray-200 bg-white p-4"><p className="text-xs font-bold text-gray-500">{label}</p><p className="mt-1 text-2xl font-black text-gray-900">{value ?? "-"}</p></div>)}</div>
      <div role="tablist" aria-label="사용자 유형" className="flex gap-2 overflow-x-auto">{(["families", "parents", "children"] as Tab[]).map((item) => <button key={item} role="tab" aria-selected={tab === item} onClick={() => changeTab(item)} className={`whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-bold ${tab === item ? "bg-slate-900 text-white" : "border border-gray-300 bg-white text-gray-700"}`}>{TAB_LABELS[item]} {data?.counts[item] ?? ""}</button>)}</div>
      {subTabs.length > 0 && <div role="tablist" aria-label="처리 유형" className="flex gap-2 overflow-x-auto">{subTabs.map(([value, label]) => <button key={value} role="tab" aria-selected={sub === value} onClick={() => changeSub(value as SubTab)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-bold ${sub === value ? "border-slate-900 text-slate-900" : "border-transparent text-gray-500"}`}>{label}</button>)}</div>}
      {sub === "plan-change" ? <PlanChangeRequestsTab /> : sub === "restorations" || sub === "approval" ? <ExistingRequestPanel kind={sub} /> : <>
        <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_auto_auto_auto_auto_auto_auto]">
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="가족명, 부모/아이 이름, 로그인 아이디 또는 이메일 검색" className="min-h-11 rounded-lg border border-gray-300 px-3 text-sm" />
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="min-h-11 rounded-lg border border-gray-300 px-3 text-sm"><option value="all">전체 상태</option>{tab === "parents" && <><option value="ACTIVE">ACTIVE</option><option value="ONBOARDING">ONBOARDING</option><option value="SUSPENDED">SUSPENDED</option></>}{tab === "families" && <option value="활성">활성</option>}{tab === "children" && <option value="등록 완료">등록 완료</option>}</select>
          <select value={internalTest} onChange={(event) => { setInternalTest(event.target.value); setPage(1); }} className="min-h-11 rounded-lg border border-gray-300 px-3 text-sm"><option value="exclude">내부 테스트 제외</option><option value="include">내부 테스트 포함</option><option value="only">테스트만</option></select>
          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 px-3 text-xs text-gray-600">시작일<input aria-label="생성 시작일" type="date" value={createdFrom} onChange={(event) => { setCreatedFrom(event.target.value); setPage(1); }} className="min-w-0 bg-transparent text-sm text-gray-900" /></label>
          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 px-3 text-xs text-gray-600">종료일<input aria-label="생성 종료일" type="date" value={createdTo} onChange={(event) => { setCreatedTo(event.target.value); setPage(1); }} className="min-w-0 bg-transparent text-sm text-gray-900" /></label>
          <select value={sort} onChange={(event) => setSort(event.target.value)} className="min-h-11 rounded-lg border border-gray-300 px-3 text-sm"><option value="created_desc">최신 생성순</option><option value="name_asc">이름순</option><option value="activity_desc">최근 활동순</option>{tab === "parents" && <option value="status_asc">상태순</option>}{tab === "children" && <option value="grade_asc">학년순</option>}</select>
          <button type="button" onClick={() => window.location.assign(`/api/admin/users/overview?${query}&format=csv`)} className="min-h-11 rounded-lg border border-slate-900 px-4 text-sm font-bold text-slate-900">CSV</button>
        </div>
        {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">사용자 정보를 불러오지 못했습니다. <span className="sr-only">{error}</span><button onClick={load} className="ml-3 font-bold underline">다시 시도</button></div> : <AdminResponsiveTable mobileStrategy="card" columns={columns} data={asArray<Row>(data?.items)} keyExtractor={(row) => row.id} isLoading={loading} onRowClick={setSelected} emptyMessage={`조건에 맞는 ${TAB_LABELS[tab]}이 없습니다.`} />}
        <div className="flex flex-wrap items-center justify-between gap-3"><label className="text-sm text-gray-600">페이지당 <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} className="ml-2 rounded border px-2 py-1"><option>25</option><option>50</option><option>100</option></select></label><div className="flex items-center gap-3"><button disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="rounded border px-4 py-2 text-sm disabled:opacity-40">이전</button><span className="text-sm">{data?.pagination?.page ?? 1} / {data?.pagination?.totalPages ?? 1} · 총 {data?.pagination?.total ?? 0}건</span><button disabled={page >= (data?.pagination?.totalPages ?? 1)} onClick={() => setPage((current) => current + 1)} className="rounded border px-4 py-2 text-sm disabled:opacity-40">다음</button></div></div>
      </>}
    </div>
    {selected && <DetailDrawer row={selected} tab={tab} onClose={() => setSelected(null)} onNavigate={navigateFromDrawer} />}
  </AdminShell>;
}
