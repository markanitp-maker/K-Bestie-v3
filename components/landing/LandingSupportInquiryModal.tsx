"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

const SUCCESS_MESSAGE = "문의가 접수되었습니다. 확인 후 입력하신 이메일로 안내드리겠습니다.";
const FAILURE_MESSAGE = "문의를 접수하지 못했습니다. 작성한 내용은 유지되니 잠시 후 다시 시도해 주세요.";

export function LandingSupportInquiryModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const emailInputRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string; requestNumber?: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    const focusTimer = window.setTimeout(() => emailInputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [isOpen, isSubmitting, onClose]);

  const handleClose = () => {
    if (!isSubmitting) onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/support/landing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, content }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("Landing support submission failed");
      setEmail("");
      setContent("");
      setMessage({ type: "success", text: SUCCESS_MESSAGE, requestNumber: payload.request_number });
    } catch (error) {
      console.error("[landing/support-inquiry] submit error:", error);
      setMessage({ type: "error", text: FAILURE_MESSAGE });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) handleClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="landing-support-inquiry-title" className="w-full max-w-[520px] rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div><h2 id="landing-support-inquiry-title" className="text-2xl font-extrabold text-[var(--color-k-navy)]">문의하기</h2><p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600">내친구 케이 이용에 궁금한 점이 있으시면 남겨주세요.{"\n"}확인 후 입력하신 이메일로 안내드리겠습니다.</p></div>
          <button type="button" onClick={handleClose} disabled={isSubmitting} aria-label="문의하기 닫기" className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"><X aria-hidden="true" className="h-5 w-5" /></button>
        </div>
        <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
          <label className="block text-sm font-bold text-slate-800">이메일<input ref={emailInputRef} type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} autoComplete="email" placeholder="답변받을 이메일을 입력해 주세요." className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4 text-base outline-none transition focus:border-[var(--color-k-orange)] focus:ring-2 focus:ring-orange-100" /></label>
          <label className="block text-sm font-bold text-slate-800">문의 내용<textarea value={content} onChange={(event) => setContent(event.target.value)} required maxLength={2000} rows={7} placeholder="궁금한 내용을 입력해 주세요." className="mt-2 w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-base leading-6 outline-none transition focus:border-[var(--color-k-orange)] focus:ring-2 focus:ring-orange-100" /><span className="mt-1 block text-right text-xs font-medium text-slate-400">{content.length.toLocaleString()} / 2,000</span></label>
          {message && <p role="status" className={`rounded-xl px-4 py-3 text-sm leading-6 ${message.type === "success" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{message.text}{message.requestNumber ? ` 접수번호는 ${message.requestNumber}입니다.` : ""}</p>}
          <button type="submit" disabled={isSubmitting} className="min-h-12 w-full rounded-full bg-[var(--color-k-orange)] px-5 py-3 font-extrabold text-[var(--color-k-navy)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? "제출 중..." : "제출하기"}</button>
        </form>
      </section>
    </div>
  );
}
