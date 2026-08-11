"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, MessageCircleMore, Sparkles, X } from "lucide-react";

const KEYWORDS = ["친구", "우주 퀴즈", "수학", "주말 나들이", "새로운 도전"];

export default function LandingWeeklyReport() {
  const [isOpen, setIsOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <>
      <div className="mx-auto w-full max-w-[590px] rounded-[28px] border border-slate-200 bg-[#F8FAFC] p-4 shadow-[0_24px_70px_rgba(16,49,91,0.10)] sm:p-5" aria-label="주간 리포트 목록 예시">
        <div className="mb-3 flex items-center justify-between px-1">
          <div>
            <p className="text-[11px] font-bold tracking-[0.15em] text-slate-400">WEEKLY FLOW</p>
            <h3 className="mt-1 text-lg font-extrabold text-[var(--color-k-navy)]">한 주의 이야기 흐름</h3>
          </div>
          <span className="text-[11px] font-bold text-slate-400">가상 리포트</span>
        </div>

        <article className="rounded-[22px] border border-sky-100 bg-sky-50 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-extrabold text-[var(--color-k-navy)]">이번 주 이야기 모으는 중</p>
            <span className="rounded-full bg-[var(--color-k-navy)] px-3 py-1.5 text-[11px] font-bold text-white">진행 중</span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">아이의 이야기가 모이고 있어요. 하루의 작은 변화가 한 주의 흐름으로 이어집니다.</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
            <div className="h-full w-[58%] rounded-full bg-sky-500" />
          </div>
          <p className="mt-2 text-right text-[11px] font-bold text-sky-700">4일의 이야기 정리 중</p>
        </article>

        <article className="mt-3 rounded-[22px] bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-extrabold text-[var(--color-k-navy)]">지난 주 리포트</h3>
            <span className="rounded-full bg-[var(--color-k-orange-tint)] px-3 py-1.5 text-[11px] font-bold text-[var(--color-k-orange)]">지난 완료 주간</span>
          </div>
          <div className="mt-5 space-y-4">
            <section>
              <h4 className="text-sm font-extrabold text-[var(--color-k-navy)]">지난 주 핵심 요약</h4>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600 sm:text-sm">친구와 함께하는 활동을 자주 이야기했고, 새로 알게 된 우주 이야기와 가족 나들이를 기대하는 모습이 보였어요.</p>
            </section>
            <section className="border-t border-slate-100 pt-4">
              <h4 className="text-sm font-extrabold text-[var(--color-k-navy)]">부모가 알아두면 좋은 점</h4>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600 sm:text-sm">좋아하는 활동이나 친구 이야기를 먼저 꺼내면 아이가 지난 주 일을 자연스럽게 이어갈 수 있어요.</p>
            </section>
            <section className="border-t border-slate-100 pt-4">
              <h4 className="text-sm font-extrabold text-[var(--color-k-navy)]">주요 키워드</h4>
              <div className="mt-2 flex flex-wrap gap-2">
                {KEYWORDS.slice(0, 3).map((keyword) => (
                  <span key={keyword} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">{keyword}</span>
                ))}
              </div>
            </section>
          </div>
          <button type="button" onClick={() => setIsOpen(true)} className="mt-4 flex min-h-11 w-full items-center justify-end gap-1 rounded-xl px-2 text-sm font-extrabold text-[var(--color-k-navy)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500">
            지난 주 상세 분석 <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </button>
        </article>

        <section className="mt-3 rounded-[22px] border border-orange-100 bg-[#FFF8F2] p-4 sm:p-5" aria-labelledby="weekly-prompt-title">
          <div className="flex items-center gap-2 text-[var(--color-k-orange)]">
            <MessageCircleMore aria-hidden="true" className="h-5 w-5" />
            <h3 id="weekly-prompt-title" className="text-xs font-extrabold">이번 주 대화 실마리</h3>
          </div>
          <p className="mt-2 text-sm font-extrabold leading-relaxed text-[var(--color-k-navy)] sm:text-base">“이번 주에 친구랑 있었던 일 중 가장 기억나는 건 뭐야?”</p>
        </section>
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setIsOpen(false);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="weekly-dialog-title" className="flex max-h-[92dvh] w-full max-w-[680px] flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
              <div>
                <p className="text-[11px] font-bold text-slate-400">가상 예시 · 지난 주 리포트</p>
                <h2 id="weekly-dialog-title" className="mt-1 text-xl font-extrabold text-[var(--color-k-navy)]">지난 주 상세 분석</h2>
              </div>
              <button ref={closeButtonRef} type="button" onClick={() => setIsOpen(false)} aria-label="주간 리포트 닫기" className="flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500">
                <X aria-hidden="true" className="h-6 w-6" />
              </button>
            </header>
            <div className="overflow-y-auto bg-slate-50 p-4 sm:p-6">
              <article className="rounded-[20px] bg-white p-5 sm:p-6">
                <h3 className="flex items-center gap-2 text-lg font-extrabold text-[var(--color-k-navy)]"><Sparkles aria-hidden="true" className="h-5 w-5 text-sky-500" /> 한 주 동안 이어진 이야기</h3>
                <div className="mt-4 space-y-4 text-sm leading-7 text-slate-600">
                  <p>지난 주 아이는 혼자 하는 활동보다 친구들과 규칙을 만들고 함께 해결하는 놀이를 자주 이야기했어요. 새로운 친구에게 먼저 다가간 순간과 함께 웃었던 일을 특히 생생하게 떠올렸습니다.</p>
                  <p>학교에서는 처음에 어렵게 느껴졌던 수학 문제를 다시 풀어 본 경험이 자신감으로 이어졌어요. 정답 자체보다 포기하지 않고 방법을 바꿔 본 과정을 중요하게 받아들이는 모습이었습니다.</p>
                  <p>관심사는 우주와 행성으로 이어졌고, 주말에는 가족과 천문관에 가 보고 싶다는 기대를 표현했어요. 친구 이야기에서 시작해 공부와 가족 활동으로 관심이 자연스럽게 넓어진 한 주였습니다.</p>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  {KEYWORDS.map((keyword) => (
                    <span key={keyword} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">{keyword}</span>
                  ))}
                </div>
              </article>
              <article className="mt-3 rounded-[20px] border border-orange-100 bg-[#FFF8F2] p-5">
                <p className="text-xs font-bold text-[var(--color-k-orange)]">부모가 이어갈 다음 대화</p>
                <p className="mt-2 font-extrabold leading-relaxed text-[var(--color-k-navy)]">친구와 함께해서 더 즐거웠던 순간부터 물어보면 학교와 관심사 이야기까지 자연스럽게 이어질 수 있어요.</p>
              </article>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
