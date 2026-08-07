"use client";

import Link from "next/link";
import Image from "next/image";

const TARGETS = [
  "초등학교 1~6학년 자녀가 있는 가정",
  "아이와의 대화를 더 잘 이어가고 싶은 보호자",
  "베타 기간 동안 꾸준히 서비스를 사용하고 의견을 줄 수 있는 가정",
];

const BENEFITS = [
  { title: "베타 기간 무료 이용", desc: "베타 기간 동안 별도 비용 없이 서비스를 이용할 수 있어요." },
  { title: "미션 대화 & 자유대화", desc: "케이와 매일 미션 대화를 나누고, 하고 싶은 이야기도 자유롭게 나눠요." },
  { title: "일일 · 주간 · 월간 리포트", desc: "아이와 케이의 대화를 바탕으로 부모님께 필요한 요약을 전해드려요." },
  { title: "케이와 놀이", desc: "MBTI, 퀴즈마스터 등 케이와 함께하는 놀이 콘텐츠도 즐길 수 있어요." },
];

const FLOW_STEPS = [
  { title: "보호자 회원가입", desc: "카카오 또는 구글로 간편하게 시작해요." },
  { title: "가족 만들기", desc: "회원가입과 함께 우리 가족 공간이 자동으로 만들어져요." },
  { title: "아이 추가", desc: "아이 이름, 학년, 관심사를 등록해 주세요." },
  { title: "아이 등록 확인", desc: "아이 등록 내용을 확인한 뒤 바로 이용할 수 있어요." },
  { title: "아이가 케이와 대화 시작", desc: "아이 아이디로 로그인하면 케이와의 첫 대화가 시작돼요." },
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
          <Image src="/Images/logo/Logo.png" alt="내친구 케이" fill priority className="object-contain object-left" />
        </div>
        <nav className="shrink-0 flex items-center gap-2" aria-label="계정 메뉴">
          <Link
            href="/login"
            className="px-3 py-2 md:px-4 md:py-2.5 rounded-full text-xs md:text-sm font-bold transition-colors"
            style={{ color: "var(--color-k-navy)" }}
          >
            로그인
          </Link>
          <Link
            href="/login"
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
                새로운 방법
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
                  href="/login"
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
              베타 테스터를 모집합니다
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
                베타 테스터에게 제공되는 혜택
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
        <section className="px-5 md:px-10 py-10 md:py-16">
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
                href="/login"
                className="w-full sm:w-auto text-center px-8 py-3.5 rounded-full font-bold text-white text-sm md:text-base"
                style={{ background: "var(--color-k-orange)" }}
              >
                시작하기
              </Link>

            </div>
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
