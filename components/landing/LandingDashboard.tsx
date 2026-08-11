import { MessageCircleMore, Sparkles } from "lucide-react";

const TOPICS = [
  { emoji: "🏫", title: "학교·학원 생활", summary: "어려운 문제를 풀어 뿌듯했어요" },
  { emoji: "👥", title: "친구 관계", summary: "친구와의 약속을 기대하고 있어요" },
  { emoji: "💛", title: "마음 흐름", summary: "새로운 활동에 설레는 하루였어요" },
  { emoji: "✨", title: "관심사·취향", summary: "요즘 우주 퀴즈에 푹 빠졌어요" },
  { emoji: "📚", title: "공부 고민", summary: "틀린 문제도 다시 도전해 봤어요" },
  { emoji: "📱", title: "디지털·콘텐츠", summary: "좋아하는 게임 이야기를 나눴어요" },
  { emoji: "👩‍🏫", title: "선생님·어른", summary: "칭찬받은 순간을 기억하고 있어요" },
  { emoji: "🔁", title: "반복 이야기", summary: "주말 나들이를 자주 떠올렸어요" },
];

export default function LandingDashboard() {
  return (
    <div
      className="relative mx-auto w-full max-w-[590px] overflow-hidden rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_24px_70px_rgba(16,49,91,0.12)] sm:p-5 lg:p-6"
      aria-label="부모 홈 대시보드 예시"
    >
      <div className="mb-4 flex items-center justify-between px-1">
        <div>
          <p className="text-[11px] font-bold tracking-[0.15em] text-slate-400">오늘의 아이 이야기</p>
          <p className="mt-1 text-base font-extrabold text-[var(--color-k-navy)] sm:text-lg">한눈에 보는 오늘</p>
        </div>
        <span className="rounded-full bg-[var(--color-k-orange-tint)] px-3 py-1.5 text-[11px] font-bold text-[var(--color-k-orange)]">
          데모 화면
        </span>
      </div>

      <section className="rounded-[22px] bg-[var(--color-k-navy)] p-5 text-white sm:p-6" aria-labelledby="dashboard-summary-title">
        <div className="flex items-center gap-2 text-sm font-bold text-sky-200">
          <Sparkles aria-hidden="true" className="h-4 w-4" />
          <h3 id="dashboard-summary-title">오늘의 한마디</h3>
        </div>
        <p className="mt-3 text-[17px] font-bold leading-[1.65] sm:text-xl">
          오늘 아이는 친구와 즐겁게 놀았던 일과 요즘 좋아하는 우주 이야기를 많이 했어요.
        </p>
      </section>

      <div className="mt-4">
        <p className="px-1 text-xs font-extrabold text-slate-500">오늘 이야기 속 8가지 흐름</p>
        <div className="mt-2.5 grid grid-cols-2 gap-2.5">
          {TOPICS.map((topic) => (
            <article key={topic.title} className="min-w-0 rounded-[18px] border border-slate-100 bg-slate-50 p-3 sm:p-4">
              <div className="flex min-w-0 items-center gap-1.5">
                <span aria-hidden="true" className="text-base sm:text-lg">{topic.emoji}</span>
                <h4 className="truncate text-[12px] font-extrabold text-[var(--color-k-navy)] sm:text-sm">
                  {topic.title}
                </h4>
              </div>
              <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-slate-500 sm:text-xs">
                {topic.summary}
              </p>
            </article>
          ))}
        </div>
      </div>

      <section className="mt-4 rounded-[22px] border border-orange-100 bg-[#FFF8F2] p-4 sm:p-5" aria-labelledby="dashboard-prompt-title">
        <div className="flex items-center gap-2 text-[var(--color-k-orange)]">
          <MessageCircleMore aria-hidden="true" className="h-5 w-5" />
          <h3 id="dashboard-prompt-title" className="text-xs font-extrabold">오늘 아이에게 이렇게 물어보세요</h3>
        </div>
        <p className="mt-2 text-[15px] font-extrabold leading-relaxed text-[var(--color-k-navy)] sm:text-base">
          “오늘 친구랑 있었던 일 중 가장 재미있었던 건 뭐였어?”
        </p>
      </section>
    </div>
  );
}
