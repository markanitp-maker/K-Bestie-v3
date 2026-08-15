"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SUPPORT_CATEGORY_LABELS, formatSupportDate, supportStatusLabel, type SupportRole } from "@/lib/support/presentation";

type SupportRequest = { id: string; request_number: string; category: string; subject: string; body: string; status: string; created_at: string; user_response: string | null; effective_role: SupportRole };

export default function SupportRequestsPage() {
  const [items, setItems] = useState<SupportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/support?pageSize=50", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("LOOKUP_FAILED");
        return response.json() as Promise<{ requests?: SupportRequest[] }>;
      })
      .then((data) => { if (active) setItems(data.requests ?? []); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return <main className="min-h-dvh bg-slate-50 px-4 py-6 text-slate-900"><div className="mx-auto max-w-2xl">
    <header className="mb-6 flex items-center justify-between gap-3"><button type="button" onClick={() => history.back()} className="rounded-xl border bg-white px-4 py-2 font-bold">뒤로</button><h1 className="text-xl font-black">내 접수</h1><span className="w-16" aria-hidden="true" /></header>
    {loading && <p className="rounded-2xl bg-white p-6 text-center text-slate-500">접수 내역을 불러오고 있어요.</p>}
    {error && <div className="rounded-2xl border border-red-200 bg-white p-6 text-center"><p>접수 내역을 불러오지 못했어요.</p><button onClick={() => location.reload()} className="mt-3 rounded-xl bg-slate-900 px-4 py-2 font-bold text-white">다시 시도</button></div>}
    {!loading && !error && items.length === 0 && <div className="rounded-2xl bg-white p-8 text-center"><p className="text-lg font-bold">아직 접수한 내용이 없어요.</p><p className="mt-2 text-sm text-slate-500">문의·건의·버그를 남기면 여기에서 처리 상태를 확인할 수 있어요.</p></div>}
    {!loading && !error && items.length > 0 && <ul className="space-y-3">{items.map((item) => {
      const role = item.effective_role;
      return <li key={item.id}><Link href={`/support/requests/${item.id}`} className="block rounded-2xl border bg-white p-4 shadow-sm transition hover:border-slate-400"><div className="flex items-center justify-between gap-3"><span className="text-xs font-bold text-slate-500">{item.request_number}</span><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-800">{supportStatusLabel(item.status, role)}</span></div><h2 className="mt-3 font-black">{SUPPORT_CATEGORY_LABELS[item.category] ?? item.category} · {item.subject}</h2><p className="mt-2 line-clamp-2 text-sm text-slate-600">{item.body}</p><div className="mt-3 flex items-center justify-between text-xs text-slate-500"><span>{formatSupportDate(item.created_at)}</span>{item.user_response && <span className="font-bold text-orange-600">답변 도착</span>}</div></Link></li>;
    })}</ul>}
  </div></main>;
}
