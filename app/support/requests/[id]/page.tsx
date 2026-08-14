"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SUPPORT_CATEGORY_LABELS, formatSupportDate, supportStatusLabel, type SupportRole } from "@/lib/support/presentation";

type Attachment = { id: string; original_filename: string; signed_url: string };
type SupportRequest = { id: string; request_number: string; category: string; subject: string; body: string; status: string; created_at: string; user_response: string | null; responded_at: string | null; effective_role: SupportRole; attachments: Attachment[] };

export default function SupportRequestDetailPage() {
  const params = useParams<{ id: string }>();
  const [item, setItem] = useState<SupportRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/support/${encodeURIComponent(params.id)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("LOOKUP_FAILED");
        return response.json() as Promise<{ request: SupportRequest }>;
      })
      .then((data) => { if (active) setItem(data.request); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [params.id]);

  const role: SupportRole = item?.effective_role ?? "parent";
  return <main className="min-h-dvh bg-slate-50 px-4 py-6 text-slate-900"><div className="mx-auto max-w-2xl">
    <header className="mb-6 flex items-center justify-between gap-3"><Link href="/support/requests" className="rounded-xl border bg-white px-4 py-2 font-bold">목록</Link><h1 className="text-xl font-black">접수 상세</h1><span className="w-16" /></header>
    {loading && <p className="rounded-2xl bg-white p-6 text-center text-slate-500">접수 내용을 불러오고 있어요.</p>}
    {error && <div className="rounded-2xl border border-red-200 bg-white p-6 text-center"><p>접수 내용을 확인하지 못했어요.</p><button onClick={() => location.reload()} className="mt-3 rounded-xl bg-slate-900 px-4 py-2 font-bold text-white">다시 시도</button></div>}
    {item && <div className="space-y-4"><section className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between gap-3"><span className="text-sm font-bold text-slate-500">{item.request_number}</span><span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-bold text-blue-800">{supportStatusLabel(item.status, role)}</span></div><h2 className="mt-4 text-lg font-black">{SUPPORT_CATEGORY_LABELS[item.category] ?? item.category} · {item.subject}</h2><p className="mt-2 text-sm text-slate-500">{formatSupportDate(item.created_at)}</p><p className="mt-5 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 leading-7">{item.body}</p></section>
      {item.attachments.length > 0 && <section className="rounded-2xl border bg-white p-5"><h2 className="font-black">첨부 이미지</h2><div className="mt-3 grid grid-cols-2 gap-3">{item.attachments.map((attachment) => <a key={attachment.id} href={attachment.signed_url} target="_blank" rel="noreferrer"><img src={attachment.signed_url} alt={attachment.original_filename || "문의 첨부 이미지"} className="aspect-square w-full rounded-xl border object-cover" /></a>)}</div></section>}
      <section className="rounded-2xl border border-orange-200 bg-orange-50 p-5"><h2 className="text-lg font-black">{role === "child" ? "케이팀에서 답장이 왔어" : "관리자 답변"}</h2>{item.user_response ? <><p className="mt-4 whitespace-pre-wrap break-words leading-7">{item.user_response}</p>{item.responded_at && <p className="mt-3 text-xs text-slate-500">{formatSupportDate(item.responded_at)}</p>}</> : <p className="mt-3 text-sm text-slate-600">{role === "child" ? "답변을 준비하고 있어. 조금만 기다려 줘." : "답변을 준비 중입니다."}</p>}</section></div>}
  </div></main>;
}
