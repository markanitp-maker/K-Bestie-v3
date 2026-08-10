"use client";

import Link from "next/link";
import Image from "next/image";
import { logAuthFlowEvent } from "@/lib/analytics/authFlowClient";

const TARGETS = [
  "초등학교 1~6학년 자녀가 있는 가정",
  "아이와의 대화를 더 잘 이어가고 싶은 보호자",
  "베타 기간 동안 꾸준히 서비스를 사용하고 의견을 줄 수 있는 가정",
];

const BENEFITS = [
  { title: "베타 기간 무료 이용", desc: "베타 기간 동안 별도 비용 없이 서비스를 이용할 수 있어요." },
  { title: "미션 대화 & 자유대화", desc: "케이와 매일 미션 대화를 나누고, 하고 싶은 이야기도 자유롭게 나눠요." },
  { title: "일일 · 주간 리포트", desc: "아이와 케이의 대화를 바탕으로 부모님께 필요한 요약을 전해드려요." },
  { title: "케이와 놀이", desc: "MBTI, 퀴즈마스터 등 케이와 함께하는 놀이 콘텐츠도 즐길 수 있어요." },
];

const FLOW_STEPS = [
  { title: "보호자 회원가입", desc: "카카오 또는 구글로 간편하게 시작해요." },
  { title: "가족 만들기", desc: "회원가입과 함께 우리 가족 공간이 자동으로 만들어져요." },
  { title: "아이 추가", desc: "아이 이름, 학년, 관심사를 등록해 주세요." },
  { title: "아이 등록 확인", desc: "아이 등록 내용을 확인한 뒤 바로 이용할 수 있어요." },
  { title: "아이가 케이와 대화 시작", desc: "아이 아이디로 로그인하면 케이와의 첫 대화가 시작돼요." },
];

const FAQ_ITEMS = [
  {
    question: "내친구 케이는 어떤 서비스인가요?",
    answer:
      "내친구 케이는 초등학생 아이와 부모의 대화를 잇는 AI 소통 서비스입니다. 아이가 케이와 나눈 대화를 부모에게 필요한 요약과 오늘의 대화거리로 연결합니다.",
  },
  {
    question: "아이는 내친구 케이에서 무엇을 하나요?",
    answer:
      "아이는 케이와 매일 미션 대화를 나누거나 하고 싶은 이야기를 자유롭게 나눌 수 있습니다. MBTI와 퀴즈마스터 같은 놀이 콘텐츠도 이용할 수 있습니다.",
  },
  {
    question: "부모는 어떤 도움을 받을 수 있나요?",
    answer:
      "부모는 아이와 케이의 대화를 바탕으로 정리된 일일·주간 리포트를 확인할 수 있습니다. 리포트는 아이와 대화를 이어갈 때 참고할 요약을 제공하며, 아이의 마음이나 심리 상태를 진단하지 않습니다.",
  },
  {
    question: "누가 이용할 수 있나요?",
    answer:
      "현재 베타 서비스는 초등학교 1~6학년 자녀가 있는 가정을 대상으로 합니다. 보호자가 먼저 가입하고 가족 공간과 아이 계정을 준비한 뒤 아이가 이용을 시작합니다.",
  },
];

const faqUrl = process.env.NEXT_PUBLIC_FAQ_URL;
const isValidFaqUrl = typeof faqUrl === "string" && /^https?:\/\//.test(faqUrl);

export default function BetaLandingPage() {
  return (
    <div className="min-h-dvh w-full overflow-x-hidden" style={{ background: "var(--color-k-background)" }}>
      {/* 헤더 */}
      <header
        className="sticky top-0 z-40 w-full flex items-center justify-between px-5 md:px-10 h-14 md:h-[72px] bg-white border-b"
        style={{ borderColor: "var(--color-k-border)" }}
      >
        <div className="relative h-8 w-28 md:h-10 md:w-36">
          <Image
            src="/Images/logo/Logo.png"
            alt="내친구 케이"
            fill
            priority
            sizes="(max-width: 767px) 112px, 144px"
            className="object-contain object-left"
          />
        </div>
        <nav className="shrink-0 flex items-center gap-2" aria-label="계정 메뉴">
          <Link
            href="/login?entry=header_login"
            onClick={() => void logAuthFlowEvent("header_login_clicked")}
            className="px-3 py-2 md:px-4 md:py-2.5 rounded-full text-xs md:text-sm font-bold transition-colors"
            style={{ color: "var(--color-k-navy)" }}
          >
            로그인
          </Link>
          <Link
            href="/login?entry=header_signup"
            onClick={() => void logAuthFlowEvent("header_signup_clicked")}
            className="px-3 py-2 md:px-4 md:py-2.5 rounded-full text-xs md:text-sm font-bold border transition-colors"
            style={{ borderColor: "var(--color-k-navy)", color: "var(--color-k-navy)" }}
          >
            회원가입
          </Link>
        </nav>
      </header>

      <main className="w-full">
        {/* 히어로 */}
        <section className="px-5 md:px-10 py-10 md:py-16">
          <div className="max-w-[1280px] mx-auto flex flex-col md:flex-row items-center gap-8 md:gap-12">
            <div className="flex-1 flex flex-col items-center md:items-start text-center md:text-left order-2 md:order-1">
              <h1
                className="text-[30px] leading-tight md:text-[52px] font-extrabold"
                style={{ color: "var(--color-k-text-primary)" }}
              >
                아이의 하루를 이해하는
                <br />
                새로운 방법, 내친구 케이
              </h1>
              <p
                className="mt-4 text-sm md:text-lg max-w-md"
                style={{ color: "var(--color-k-text-secondary)" }}
              >
                내친구 케이는 아이와 케이의 대화를 부모에게 필요한 요약과 오늘의
                대화거리로 연결하는 AI 소통 서비스입니다.
              </p>
              <div className="mt-7 flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                <Link
                  href="/login?entry=landing_start"
                  onClick={() => void logAuthFlowEvent("landing_start_clicked")}
                  className="w-full sm:w-auto text-center px-7 py-3.5 rounded-full font-bold text-white text-sm md:text-base transition-opacity active:opacity-80"
                  style={{ background: "var(--color-k-orange)" }}
                >
                  시작하기
                </Link>
              </div>
            </div>
            <div className="relative h-[220px] w-[220px] md:h-[480px] md:w-[480px] shrink-0 order-1 md:order-2">
              <Image
                src="/Images/mascot/mascot-standing.png"
                alt="내친구 케이 마스코트"
                fill
                priority
                sizes="(max-width: 767px) 220px, 480px"
                className="object-contain"
              />
            </div>
          </div>
        </section>

        {/* 베타 안내 */}
        <section
          id="features"
          className="px-5 md:px-10 py-10 md:py-16 scroll-mt-14 md:scroll-mt-[72px]"
          style={{ background: "var(--color-k-surface)" }}
        >
          <div className="max-w-[1280px] mx-auto">
            <h2
              className="text-2xl md:text-4xl font-extrabold text-center"
              style={{ color: "var(--color-k-text-primary)" }}
            >
              베타 서비스를 시작합니다.
            </h2>

            <div className="mt-8 md:mt-10">
              <h3 className="text-sm md:text-base font-bold mb-3" style={{ color: "var(--color-k-text-primary)" }}>
                이런 가정을 찾고 있어요
              </h3>
              <ul className="flex flex-col gap-2.5 md:grid md:grid-cols-3 md:gap-4">
                {TARGETS.map((t) => (
                  <li
                    key={t}
                    className="rounded-2xl bg-white px-4 py-3.5 text-sm md:text-[15px]"
                    style={{ boxShadow: "var(--shadow-k-card)", color: "var(--color-k-text-primary)" }}
                  >
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-8 md:mt-10">
              <h3 className="text-sm md:text-base font-bold mb-3" style={{ color: "var(--color-k-text-primary)" }}>
                베타 서비스 기간에 제공되는 혜택
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                {BENEFITS.map((b) => (
                  <div
                    key={b.title}
                    className="rounded-2xl bg-white p-4 md:p-5"
                    style={{ boxShadow: "var(--shadow-k-card)" }}
                  >
                    <p className="text-sm md:text-[15px] font-bold" style={{ color: "var(--color-k-orange)" }}>
                      {b.title}
                    </p>
                    <p className="mt-1.5 text-xs md:text-sm" style={{ color: "var(--color-k-text-secondary)" }}>
                      {b.desc}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <p className="mt-6 text-center text-xs md:text-sm" style={{ color: "var(--color-k-text-secondary)" }}>
              회원가입을 완료하시면 바로 베타를 시작하실 수 있어요.
            </p>
          </div>
        </section>

        {/* 이용 흐름 */}
        <section id="how-it-works" className="px-5 md:px-10 py-10 md:py-16 scroll-mt-14 md:scroll-mt-[72px]">
          <div className="max-w-[1280px] mx-auto">
            <h2
              className="text-2xl md:text-4xl font-extrabold text-center"
              style={{ color: "var(--color-k-text-primary)" }}
            >
              이렇게 시작해요
            </h2>
            <ol className="mt-8 md:mt-10 flex flex-col gap-3 md:grid md:grid-cols-5 md:gap-4">
              {FLOW_STEPS.map((step, i) => (
                <li
                  key={step.title}
                  className="rounded-2xl px-4 py-4 md:py-5 flex md:flex-col gap-3 md:gap-2 items-start"
                  style={{ background: "var(--color-k-navy-tint)" }}
                >
                  <span
                    className="shrink-0 w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center text-xs md:text-sm font-bold text-white"
                    style={{ background: "var(--color-k-navy)" }}
                  >
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm md:text-[15px] font-bold" style={{ color: "var(--color-k-text-primary)" }}>
                      {step.title}
                    </p>
                    <p className="mt-0.5 text-xs md:text-sm" style={{ color: "var(--color-k-text-secondary)" }}>
                      {step.desc}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-9 flex justify-center">
              <Link
                href="/login?entry=landing_start"
                onClick={() => void logAuthFlowEvent("landing_start_clicked")}
                className="w-full sm:w-auto text-center px-8 py-3.5 rounded-full font-bold text-white text-sm md:text-base"
                style={{ background: "var(--color-k-orange)" }}
              >
                시작하기
              </Link>

            </div>
          </div>
        </section>

        <section
          id="faq"
          className="px-5 md:px-10 py-10 md:py-16 scroll-mt-14 md:scroll-mt-[72px]"
          style={{ background: "var(--color-k-surface)" }}
          aria-labelledby="faq-title"
        >
          <div className="max-w-[880px] mx-auto">
            <h2
              id="faq-title"
              className="text-2xl md:text-4xl font-extrabold text-center"
              style={{ color: "var(--color-k-text-primary)" }}
            >
              자주 묻는 질문
            </h2>
            <div className="mt-8 md:mt-10 grid gap-3 md:gap-4">
              {FAQ_ITEMS.map((item) => (
                <article
                  key={item.question}
                  className="rounded-2xl bg-white p-5 md:p-6"
                  style={{ boxShadow: "var(--shadow-k-card)" }}
                >
                  <h3
                    className="text-base md:text-lg font-bold"
                    style={{ color: "var(--color-k-text-primary)" }}
                  >
                    {item.question}
                  </h3>
                  <p
                    className="mt-2 text-sm md:text-[15px] leading-relaxed"
                    style={{ color: "var(--color-k-text-secondary)" }}
                  >
                    {item.answer}
                  </p>
                </article>
              ))}
            </div>
            <p className="mt-5 text-center text-xs md:text-sm" style={{ color: "var(--color-k-text-secondary)" }}>
              개인정보 처리와 법정대리인 동의에 관한 자세한 내용은{" "}
              <Link href="/privacy" className="font-bold underline underline-offset-2">
                개인정보처리방침
              </Link>
              에서 확인할 수 있습니다.
            </p>
          </div>
        </section>
      </main>

      {/* 푸터 */}
      <footer
        className="px-5 md:px-10 py-8 md:py-10 border-t"
        style={{ borderColor: "var(--color-k-border)", background: "var(--color-k-surface)" }}
      >
        <div className="max-w-[1280px] mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs md:text-sm" style={{ color: "var(--color-k-text-secondary)" }}>
            <a href="#features" className="underline underline-offset-2">
              서비스 소개
            </a>
            <a href="#faq" className="underline underline-offset-2">
              자주 묻는 질문
            </a>
            <Link href="/privacy" className="underline underline-offset-2">
              개인정보처리방침
            </Link>
            <span aria-disabled="true" className="opacity-60 cursor-not-allowed">
              이용약관 준비 중입니다
            </span>
            {isValidFaqUrl ? (
              <a href={faqUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                문의하기 · FAQ
              </a>
            ) : (
              <span aria-disabled="true" className="opacity-60 cursor-not-allowed">
                문의하기 · FAQ 준비 중입니다
              </span>
            )}
          </div>
          <p className="text-[11px] md:text-xs" style={{ color: "var(--color-k-disabled)" }}>
            사업자 정보 준비 중입니다.
          </p>
        </div>
      </footer>
    </div>
  );
}
