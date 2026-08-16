"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminShell, type AdminPageId } from "@/components/admin/shell/AdminShell";
import { AdminPageHeader } from "@/components/admin/shell/AdminPageHeader";
import { AdminResponsiveTable } from "@/components/admin/shell/AdminResponsiveTable";
import { AdminStatusBadge } from "@/components/admin/shell/AdminStatusBadge";
import { CATEGORY_LABELS, CUSTOMER_REQUEST_STATUSES, STATUS_LABELS, type CustomerRequestCategory, type CustomerRequestStatus } from "@/lib/admin/customerRequests";

type Row = Record<string, any>;
type ResponseData = {
  requests: Row[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  counters: { total: number; categories: Record<string, number>; statuses: Record<string, number> };
};

const CATEGORIES: Array<{ value: "" | CustomerRequestCategory; label: string }> = [
  { value: "", label: "전체" },
  { value: "inquiry", label: "문의" },
  { value: "suggestion", label: "건의" },
  { value: "bug", label: "버그" },
  { value: "voc", label: "기존 문의·건의" },
];
const nextStatus = (status: CustomerRequestStatus) => CUSTOMER_REQUEST_STATUSES[CUSTOMER_REQUEST_STATUSES.indexOf(status) + 1] ?? null;
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "-";
const statusVariant = (status: string): "success" | "warning" | "danger" | "neutral" => status === "resolved" ? "success" : status === "in_progress" ? "warning" : status === "closed" ? "neutral" : "danger";
const kstDate = (offsetDays = 0) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const today = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
  return new Date(new Date(`${today}T12:00:00Z`).getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);
};

function RequestDrawer({ row, onClose, onChanged, onNavigateUser }: { row: Row; onClose: () => void; onChanged: () => void; onNavigateUser: (tab: "families" | "parents" | "children", search: string) => void }) {
  const [note, setNote] = useState(row.admin_note ?? "");
  const [status, setStatus] = useState<CustomerRequestStatus>(row.status);
  const [category, setCategory] = useState<CustomerRequestCategory>(row.category);
  const [busy, setBusy] = useState(false);
  const allowedNext = nextStatus(row.status);

  const save = async () => {
    if (row.category === "voc" && category !== "voc" && !window.confirm(`이 접수 건을 '${CATEGORY_LABELS[category]}'로 분류하시겠습니까?\n기존 접수번호와 상태는 유지됩니다.`)) return;
    setBusy(true);
    const response = await fetch(`/api/admin/support-requests/${row.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, admin_note: note, category }),
    });
    setBusy(false);
    if (!response.ok) return window.alert((await response.json().catch(() => ({}))).error || "변경하지 못했습니다.");
    onChanged(); onClose();
  };

  const remove = async () => {
    const reason = window.prompt("휴지통으로 이동할 사유를 입력하세요.");
    if (!reason?.trim()) return;
    if (!window.confirm("이 접수를 휴지통으로 이동할까요? 30일 동안 복구할 수 있습니다.")) return;
    setBusy(true);
    const response = await fetch("/api/admin/trash/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource: "support_requests", ids: [row.id], reason }) });
    setBusy(false);
    if (!response.ok) return window.alert((await response.json().catch(() => ({}))).error || "삭제하지 못했습니다.");
    onChanged(); onClose();
  };

  return <div role="dialog" aria-modal="true" aria-label="고객 접수 상세" className="fixed inset-0 z-[200] bg-black/30" onClick={onClose}>
    <aside className="absolute right-0 top-0 h-full w-full max-w-[600px] overflow-y-auto bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-gray-500">{row.request_number}</p><h2 className="mt-1 text-xl font-black text-gray-900">{row.subject}</h2></div><button onClick={onClose} className="rounded-lg border px-3 py-2 text-sm font-bold">닫기</button></div>
      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-3 rounded-xl border bg-gray-50 p-4 text-sm">
        <dt className="text-gray-500">유형</dt><dd className="font-bold">{CATEGORY_LABELS[row.category as CustomerRequestCategory] ?? row.category}</dd>
        <dt className="text-gray-500">제출자</dt><dd><button onClick={() => onNavigateUser(row.submitter_role === "child" ? "children" : "parents", row.submitter_login || row.submitter_name || "")} className="font-bold text-blue-700 underline">{row.submitter_name || "이름 미등록"}</button><span className="ml-2 text-gray-500">{row.submitter_login || "로그인 정보 없음"} · {row.submitter_role === "child" ? "아이" : "부모"}</span></dd>
        <dt className="text-gray-500">가족</dt><dd>{row.family_name ? <button onClick={() => onNavigateUser("families", row.family_name)} className="font-bold text-blue-700 underline">{row.family_name}</button> : "가족 정보 없음"}</dd>
        <dt className="text-gray-500">접수일</dt><dd>{formatDate(row.created_at)}</dd>
        <dt className="text-gray-500">화면</dt><dd>{row.current_route || "-"} · {row.app_surface || "-"} · {row.app_version || "버전 미수집"}</dd>
      </dl>
      <section className="mt-5"><h3 className="mb-2 font-bold">접수 내용</h3><div className="whitespace-pre-wrap break-words rounded-xl border p-4 text-sm leading-6">{row.body}</div>{row.category !== "bug" && <p className="mt-2 text-xs text-gray-500">관련 세션: {row.play_session_id ? "연결됨" : "없음"} · 보호자 연결: {row.guardian_id ? "연결됨" : "없음"}</p>}</section>
      {row.category === "bug" && <section className="mt-5"><h3 className="mb-2 font-bold">오류 환경</h3><pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-4 text-xs text-slate-100">{JSON.stringify(row.device_info ?? {}, null, 2)}</pre></section>}
      {(row.attachments ?? []).length > 0 && <section className="mt-5"><h3 className="mb-2 font-bold">첨부파일</h3><div className="space-y-2">{row.attachments.map((item: Row) => item.signed_url ? <a key={item.id} href={item.signed_url} target="_blank" rel="noreferrer" className="block rounded-lg border p-3 text-sm font-bold text-blue-700 underline">{item.original_filename || "첨부파일 보기"}</a> : null)}</div></section>}
      <section className="mt-6 space-y-4 rounded-xl border p-4"><h3 className="font-bold">처리</h3>
        <label className="block text-sm font-semibold">상태<select value={status} onChange={(event) => setStatus(event.target.value as CustomerRequestStatus)} className="mt-1 w-full rounded-lg border p-3"><option value={row.status}>{STATUS_LABELS[row.status as CustomerRequestStatus]}</option>{allowedNext && <option value={allowedNext}>{STATUS_LABELS[allowedNext]}</option>}</select></label>
        {row.category === "voc" && <label className="block text-sm font-semibold">기존 접수 수동 분류<select value={category} onChange={(event) => setCategory(event.target.value as CustomerRequestCategory)} className="mt-1 w-full rounded-lg border p-3"><option value="voc">기존 문의·건의 유지</option><option value="inquiry">문의로 분류</option><option value="suggestion">건의로 분류</option></select></label>}
        <label className="block text-sm font-semibold">관리자 메모<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={4000} rows={5} className="mt-1 w-full resize-y rounded-lg border p-3" placeholder="내부 처리 메모" /></label>
        <button disabled={busy} onClick={save} className="w-full rounded-lg bg-slate-900 px-4 py-3 font-bold text-white disabled:opacity-50">저장</button>
      </section>
      {(row.audit_history ?? []).length > 0 && <section className="mt-5"><h3 className="mb-2 font-bold">변경 이력</h3><ol className="space-y-2">{row.audit_history.map((item: Row, index: number) => <li key={`${item.created_at}-${index}`} className="rounded-lg border p-3 text-xs"><b>{item.action}</b><span className="ml-2 text-gray-500">{item.admin_email || "시스템"} · {formatDate(item.created_at)}</span></li>)}</ol></section>}
      <details className="mt-8 rounded-xl border border-red-200 p-4"><summary className="cursor-pointer font-bold text-red-700">삭제 작업</summary><button disabled={busy} onClick={remove} className="mt-4 rounded-lg border border-red-500 px-4 py-2 font-bold text-red-700">휴지통으로 이동</button></details>
    </aside>
  </div>;
}

export default function CustomerRequestsPage() {
  const router = useRouter();
  const [category, setCategory] = useState<"" | CustomerRequestCategory>("");
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<ResponseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<Row | null>(null);

  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 350); return () => clearTimeout(timer); }, [search]);
  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (category) params.set("category", category); if (status) params.set("status", status); if (role) params.set("submitter_role", role); if (query) params.set("q", query); if (startDate) params.set("startDate", startDate); if (endDate) params.set("endDate", endDate);
    const response = await fetch(`/api/admin/support-requests?${params}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) window.alert(payload?.error || "고객 접수를 불러오지 못했습니다."); else setData(payload);
    setLoading(false);
  }, [category, status, role, query, startDate, endDate, page, pageSize]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSelected(new Set()); }, [category, status, role, query, startDate, endDate, page, pageSize]);

  const rows = data?.requests ?? [];
  const allChecked = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map((row) => row.id)));
  const bulkStatus = async (target: CustomerRequestStatus) => {
    if (!selected.size || !window.confirm(`${selected.size}건을 '${STATUS_LABELS[target]}' 상태로 변경할까요?`)) return;
    const response = await fetch("/api/admin/support-requests/bulk-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(selected), status: target }) });
    if (!response.ok) window.alert((await response.json().catch(() => ({}))).error || "일괄 변경하지 못했습니다."); else load();
  };
  const bulkDelete = async () => {
    const reason = window.prompt(`${selected.size}건을 휴지통으로 이동할 사유를 입력하세요.`); if (!reason?.trim()) return;
    if (!window.confirm("선택한 접수를 휴지통으로 이동할까요?")) return;
    const response = await fetch("/api/admin/trash/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource: "support_requests", ids: Array.from(selected), reason }) });
    if (!response.ok) window.alert((await response.json().catch(() => ({}))).error || "일괄 삭제하지 못했습니다."); else load();
  };
  const onMenuChange = (id: AdminPageId) => { if (id === "customer-requests") return; router.push(id === "users" ? "/admin/users" : `/admin?page=${id}`); };
  const categoryCounters = data?.counters.categories ?? {};
  const setPeriod = (days: number | null) => { setEndDate(days === null ? "" : kstDate()); setStartDate(days === null ? "" : kstDate(-(days - 1))); setPage(1); };
  const columns = useMemo(() => [
    { key: "select", header: <input type="checkbox" aria-label="현재 페이지 전체 선택" checked={allChecked} onChange={toggleAll} />, render: (row: Row) => <input type="checkbox" aria-label={`${row.request_number} 선택`} checked={selected.has(row.id)} onClick={(event) => event.stopPropagation()} onChange={() => setSelected((before) => { const next = new Set(before); next.has(row.id) ? next.delete(row.id) : next.add(row.id); return next; })} /> },
    { key: "number", header: "접수번호", render: (row: Row) => <><b>{row.request_number}</b><span className="block text-xs text-gray-500">{formatDate(row.created_at)}</span></> },
    { key: "category", header: "유형", render: (row: Row) => CATEGORY_LABELS[row.category as CustomerRequestCategory] ?? row.category },
    { key: "subject", header: "제목·내용", render: (row: Row) => <div className="max-w-[360px]"><b className="block truncate">{row.subject}</b><span className="block truncate text-xs text-gray-500">{row.body}</span></div> },
    { key: "submitter", header: "제출자", render: (row: Row) => <>{row.submitter_name || "이름 미등록"}<span className="block text-xs text-gray-500">{row.submitter_login || (row.submitter_role === "child" ? "아이" : "부모")}</span></> },
    { key: "status", header: "상태", render: (row: Row) => <AdminStatusBadge text={STATUS_LABELS[row.status as CustomerRequestStatus] ?? row.status} variant={statusVariant(row.status)} /> },
  ], [allChecked, selected]);

  return <AdminShell activeMenuId="customer-requests" onMenuChange={onMenuChange}><div className="p-4 md:p-8">
    <AdminPageHeader title="고객 접수" description="문의·건의·버그를 한 화면에서 조회하고 처리합니다. 기존 VOC는 수동 분류 전까지 그대로 보존됩니다." />
    <div className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-5">{CATEGORIES.map((item) => <button key={item.value || "all"} onClick={() => { setCategory(item.value); setPage(1); }} className={`rounded-xl border p-3 text-left ${category === item.value ? "border-slate-900 bg-slate-900 text-white" : "bg-white"}`}><span className="block text-xs font-semibold opacity-70">{item.label}</span><b className="text-xl">{item.value ? categoryCounters[item.value] ?? 0 : data?.counters.total ?? 0}</b></button>)}</div>
    <div className="mb-4 grid gap-2 rounded-xl border bg-white p-3 md:grid-cols-6">
      <input aria-label="고객 접수 검색" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="접수번호·제목·내용·이름·로그인 ID" className="rounded-lg border p-2 md:col-span-2" />
      <select aria-label="상태 필터" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="rounded-lg border p-2"><option value="">전체 상태</option>{CUSTOMER_REQUEST_STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]} ({data?.counters.statuses[value] ?? 0})</option>)}</select>
      <select aria-label="제출자 필터" value={role} onChange={(event) => { setRole(event.target.value); setPage(1); }} className="rounded-lg border p-2"><option value="">부모·아이 전체</option><option value="parent">부모</option><option value="child">아이</option></select>
      <input aria-label="시작일" type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); setPage(1); }} className="rounded-lg border p-2" />
      <input aria-label="종료일" type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); setPage(1); }} className="rounded-lg border p-2" />
      <div className="flex flex-wrap gap-1 md:col-span-6"><span className="mr-1 self-center text-xs font-bold text-gray-500">빠른 기간</span><button onClick={() => setPeriod(1)} className="rounded border px-2 py-1 text-xs">오늘</button><button onClick={() => setPeriod(7)} className="rounded border px-2 py-1 text-xs">최근 7일</button><button onClick={() => setPeriod(30)} className="rounded border px-2 py-1 text-xs">최근 30일</button><button onClick={() => setPeriod(null)} className="rounded border px-2 py-1 text-xs">전체</button></div>
    </div>
    {selected.size > 0 && <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3"><b>{selected.size}건 선택</b>{CUSTOMER_REQUEST_STATUSES.slice(1).map((value) => <button key={value} onClick={() => bulkStatus(value)} className="rounded-lg border bg-white px-3 py-2 text-sm font-bold">{STATUS_LABELS[value]}로</button>)}<button onClick={bulkDelete} className="rounded-lg border border-red-400 bg-white px-3 py-2 text-sm font-bold text-red-700">휴지통</button></div>}
    <AdminResponsiveTable mobileStrategy="card" columns={columns} data={rows} keyExtractor={(row) => row.id} isLoading={loading} emptyMessage="조건에 맞는 고객 접수가 없습니다." onRowClick={setDrawer} />
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"><span>총 {data?.pagination.total ?? 0}건 · {data?.pagination.page ?? 1}/{data?.pagination.totalPages ?? 1}페이지</span><div className="flex items-center gap-2"><select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} className="rounded border p-2"><option value={25}>25개</option><option value={50}>50개</option><option value={100}>100개</option></select><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded border px-3 py-2 disabled:opacity-40">이전</button><button disabled={page >= (data?.pagination.totalPages ?? 1)} onClick={() => setPage((value) => value + 1)} className="rounded border px-3 py-2 disabled:opacity-40">다음</button></div></div>
  </div>{drawer && <RequestDrawer row={drawer} onClose={() => setDrawer(null)} onChanged={load} onNavigateUser={(tab, value) => router.push(`/admin/users?tab=${tab}&search=${encodeURIComponent(value)}`)} />}</AdminShell>;
}
