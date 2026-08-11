"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Eye, MessageCircleMore, Sparkles, X } from "lucide-react";

type DailyTab = "summary" | "detail" | "guide";

const DAYS = [
  { label: "일", checked: true },
  { label: "월", checked: true },
  { label: "화", checked: true },
  { label: "수", checked: false },
  { label: "목", checked: false },
  { label: "금", checked: false },
  { label: "토", checked: true },
];

const DETAIL_SECTIONS = [
  { title: "학교·학원 생활", body: "어려웠던 수학 문제를 끝까지 풀어낸 경험과 선생님에게 칭찬받아 뿌듯했던 순간을 이야기했어요." },
  { title: "친구 관계와 또래 생활", body: "쉬는 시간에 친구들과 만든 새로운 놀이와 다음에 함께하고 싶은 활동을 즐겁게 떠올렸어요." },
  { title: "감정 힌트·마음 흐름", body: "처음에는 문제가 어려워 답답했지만 스스로 해결한 뒤에는 자신감과 성취감을 느꼈어요." },
  { title: "관심사와 개인 취향", body: "우주 퀴즈와 행성 이야기에 관심을 보였고 가족에게도 새로 알게 된 내용을 알려주고 싶어 했어요." },
];

const TABS: { id: DailyTab; label: string }[] = [
  { id: "summary", label: "빠른 요약" },
  { id: "detail", label: "상세 보기" },
  { id: "guide", label: "추천 가이드" },
];

export default function LandingDailyReport() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DailyTab>("detail");
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

  const openReport = () => {
    setActiveTab("detail");
    setIsOpen(true);
  };

  return (
    <>
      <div className="mx-auto w-full max-w-[590px] rounded-[28px] border border-slate-200 bg-[#F8FAFC] p-4 shadow-[0_24px_70px_rgba(16,49,91,0.10)] sm:p-5" aria-label="일간 리포트 목록 예시">
        <div className="rounded-[22px] bg-white p-4 sm:p-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-bold text-sky-700">이번 주</span>
              <h3 className="mt-2 text-lg font-extrabold text-[var(--color-k-navy)]">매일 쌓이는 아이의 이야기</h3>
            </div>
            <p className="text-[11px] font-semibold text-slate-400">가상 리포트</p>
          </div>
          <div className="mt-5 grid grid-cols-7 gap-1.5" aria-label="이번 주 리포트 생성 현황">
            {DAYS.map((day) => (
              <div key={day.label} className="flex flex-col items-center gap-2">
                <span className="text-[11px] font-bold text-slate-500">{day.label}</span>
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full border sm:h-9 sm:w-9 ${day.checked ? "border-sky-500 bg-sky-500 text-white" : "border-slate-200 bg-white text-slate-300"}`}
                  aria-label={`${day.label}요일 ${day.checked ? "리포트 완료" : "리포트 대기"}`}
                >
                  {day.checked ? <Check aria-hidden="true" className="h-4 w-4" strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-200" />}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 grid gap-3">
          <article className="rounded-[22px] bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-extrabold text-[var(--color-k-navy)]">최근 대화 요약</h3>
              <span className="rounded-full bg-[var(--color-k-orange-tint)] px-2.5 py-1 text-[11px] font-bold text-[var(--color-k-orange)]">어제</span>
            </div>
            <div className="mt-3 space-y-2 text-[13px] leading-relaxed text-slate-600 sm:text-sm">
              <p>수학 문제를 스스로 풀어낸 일이 기억에 남아 자신감이 한층 커진 하루였어요.</p>
              <p>친구들과 새로 만든 놀이와 요즘 좋아하는 우주 퀴즈 이야기도 즐겁게 나눴어요.</p>
            </div>
            <button type="button" onClick={openReport} className="mt-4 flex min-h-11 w-full items-center justify-end gap-1 rounded-xl px-2 text-sm font-extrabold text-[var(--color-k-navy)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500">
              자세히 보기 <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </article>

          <article className="rounded-[22px] border border-slate-100 bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-extrabold text-[var(--color-k-navy)]">그저께 이야기</h3>
              <span className="text-[11px] font-bold text-slate-400">지난 대화</span>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-slate-600 sm:text-sm">
              주말 나들이에서 본 동물을 떠올리며 가족과 다시 가고 싶은 곳을 이야기했어요.
            </p>
          </article>
        </div>
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setIsOpen(false);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="daily-dialog-title" className="flex max-h-[92dvh] w-full max-w-[680px] flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
              <div>
                <p className="text-[11px] font-bold text-slate-400">가상 예시 · 어제 리포트</p>
                <h2 id="daily-dialog-title" className="mt-1 text-xl font-extrabold text-[var(--color-k-navy)]">일간 리포트</h2>
              </div>
              <button ref={closeButtonRef} type="button" onClick={() => setIsOpen(false)} aria-label="일간 리포트 닫기" className="flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500">
                <X aria-hidden="true" className="h-6 w-6" />
              </button>
            </header>

            <div className="grid grid-cols-3 gap-1 border-b border-slate-100 p-2" role="tablist" aria-label="일간 리포트 보기 방식">
              {TABS.map((tab) => (
                <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`daily-panel-${tab.id}`} id={`daily-tab-${tab.id}`} onClick={() => setActiveTab(tab.id)} className={`min-h-11 rounded-xl px-2 text-xs font-extrabold transition-colors sm:text-sm ${activeTab === tab.id ? "bg-[var(--color-k-navy)] text-white" : "text-slate-500 hover:bg-slate-50"}`}>
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="overflow-y-auto bg-slate-50 p-4 sm:p-6">
              {activeTab === "summary" && (
                <div id="daily-panel-summary" role="tabpanel" aria-labelledby="daily-tab-summary" className="space-y-3">
                  <article className="rounded-[20px] bg-[var(--color-k-navy)] p-5 text-white">
                    <p className="text-xs font-bold text-sky-200">어제 하루 요약</p>
                    <p className="mt-2 text-base font-bold leading-relaxed">어제 아이는 수학 문제를 해결해 성취감을 느꼈고, 친구와 새로운 놀이를 한 이야기를 즐겁게 나눴어요.</p>
                  </article>
                  <article className="rounded-[20px] border border-orange-100 bg-[#FFF8F2] p-5">
                    <p className="text-xs font-bold text-[var(--color-k-orange)]">오늘 아이에게 이렇게 물어보세요</p>
                    <p className="mt-2 font-extrabold leading-relaxed text-[var(--color-k-navy)]">“어려운 문제를 풀었을 때 어떤 기분이 들었어?”</p>
                  </article>
                </div>
              )}

              {activeTab === "detail" && (
                <article id="daily-panel-detail" role="tabpanel" aria-labelledby="daily-tab-detail" className="rounded-[20px] bg-white p-5 sm:p-6">
                  <h3 className="flex items-center gap-2 text-lg font-extrabold text-[var(--color-k-navy)]"><Sparkles aria-hidden="true" className="h-5 w-5 text-sky-500" /> 하루 상세 보기</h3>
                  <div className="mt-4 divide-y divide-slate-100">
                    {DETAIL_SECTIONS.map((section) => (
                      <section key={section.title} className="py-4 first:pt-0 last:pb-0">
                        <h4 className="text-sm font-extrabold text-[var(--color-k-navy)]">{section.title}</h4>
                        <p className="mt-1.5 text-sm leading-7 text-slate-600">{section.body}</p>
                      </section>
                    ))}
                  </div>
                </article>
              )}

              {activeTab === "guide" && (
                <div id="daily-panel-guide" role="tabpanel" aria-labelledby="daily-tab-guide" className="space-y-3">
                  <article className="rounded-[20px] bg-white p-5">
                    <h3 className="flex items-center gap-2 font-extrabold text-[var(--color-k-navy)]"><MessageCircleMore aria-hidden="true" className="h-5 w-5 text-[var(--color-k-orange)]" /> 부모 대화 실마리</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-600">결과를 바로 묻기보다 “어떤 부분이 제일 재미있었어?”라고 물으면 아이가 과정을 자연스럽게 들려줄 수 있어요.</p>
                  </article>
                  <article className="rounded-[20px] bg-white p-5">
                    <h3 className="flex items-center gap-2 font-extrabold text-[var(--color-k-navy)]"><Eye aria-hidden="true" className="h-5 w-5 text-sky-500" /> 부모가 주의 깊게 볼 변화</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-600">새로운 문제 앞에서도 쉽게 포기하지 않고 다시 시도하려는 모습이 이어지는지 편안하게 지켜봐 주세요.</p>
                  </article>
                  <article className="rounded-[20px] border border-orange-100 bg-[#FFF8F2] p-5">
                    <h3 className="flex items-center gap-2 font-extrabold text-[var(--color-k-navy)]"><Sparkles aria-hidden="true" className="h-5 w-5 text-[var(--color-k-orange)]" /> 어제의 케이 코멘트</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-600">어제 아이는 해냈다는 기쁨을 오래 간직하고 있었어요. 노력한 과정을 먼저 알아봐 주세요.</p>
                  </article>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
