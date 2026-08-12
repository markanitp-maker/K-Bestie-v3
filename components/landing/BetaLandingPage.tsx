"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  HeartHandshake,
  MessageCircleMore,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import LandingDashboard from "@/components/landing/LandingDashboard";
import LandingDailyReport from "@/components/landing/LandingDailyReport";
import LandingVideoSection from "@/components/landing/LandingVideoSection";
import LandingWeeklyReport from "@/components/landing/LandingWeeklyReport";
import { captureAttribution } from "@/lib/acquisition/captureAttribution";
import {
  logAuthFlowEvent,
  type AuthFlowEvent,
  type LandingAttribution,
} from "@/lib/analytics/authFlowClient";
import { buildPreservedHref, type PreservedLandingParams } from "@/lib/landing/preservedHref";

export type { PreservedLandingParams };

const FAQ_ITEMS = [
  {
    question: "아이가 케이와 나눈 대화를 부모가 모두 볼 수 있나요?",
    answer:
      "아니요. 부모에게 아이와 케이의 대화 원문 전체를 그대로 보여주는 방식이 아닙니다. 아이의 하루를 이해하고 자연스럽게 대화를 시작하는 데 필요한 부모용 요약 인사이트를 제공합니다.",
  },
  {
    question: "케이는 어떤 서비스인가요?",
    answer:
      "아이가 AI 친구 케이와 일상을 이야기하고, 부모가 아이의 하루와 대화 실마리를 이해할 수 있도록 연결해주는 AI 소통 서비스입니다.",
  },
  {
    question: "부모는 무엇을 확인할 수 있나요?",
    answer:
      "아이의 하루 요약, 학교·친구·관심사와 같은 이야기의 주요 흐름과 부모가 자연스럽게 대화를 시작할 수 있는 실마리를 확인할 수 있습니다.",
  },
  {
    question: "어떤 아이가 사용할 수 있나요?",
    answer:
      "현재 베타 서비스는 초등학교 1~6학년 자녀가 있는 가정을 대상으로 합니다. 보호자가 먼저 가입한 뒤 아이 계정을 준비할 수 있습니다.",
  },
  {
    question: "지금 무료인가요?",
    answer: "네. 현재 베타 서비스 기간 동안 무료로 이용할 수 있습니다.",
  },
];

const HOW_STEPS = [
  {
    number: "01",
    title: "아이가 케이와 이야기합니다",
    body: "AI 친구 케이와 자신의 하루와 관심사를 자연스럽게 이야기합니다.",
  },
  {
    number: "02",
    title: "부모에게 필요한 내용으로 정리합니다",
    body: "아이의 하루를 이해하고 대화를 시작하는 데 필요한 내용을 정리합니다.",
  },
  {
    number: "03",
    title: "부모가 아이와 이야기를 이어갑니다",
    body: "하루의 흐름과 대화 실마리를 확인하고 자연스럽게 다음 대화를 시작합니다.",
  },
];

const faqUrl = process.env.NEXT_PUBLIC_FAQ_URL;
const isValidFaqUrl = typeof faqUrl === "string" && /^https?:\/\//.test(faqUrl);

function readAttribution(): LandingAttribution {
  if (typeof window === "undefined") return {};
  const searchParams = new URLSearchParams(window.location.search);
  return {
    utmSource: searchParams.get("utm_source") ?? undefined,
    utmMedium: searchParams.get("utm_medium") ?? undefined,
    utmCampaign: searchParams.get("utm_campaign") ?? undefined,
    utmContent: searchParams.get("utm_content") ?? undefined,
    utmTerm: searchParams.get("utm_term") ?? undefined,
  };
}

function LandingPrimaryCta({
  entry,
  eventName,
  className = "",
  preservedParams,
}: {
  entry: string;
  eventName: AuthFlowEvent;
  className?: string;
  preservedParams: PreservedLandingParams;
}) {
  const href = buildPreservedHref(`/login?entry=${entry}`, preservedParams);
  return (
    <Link
      href={href}
      onClick={() => {
        const attribution = readAttribution();
        void logAuthFlowEvent("landing_start_clicked", attribution);
        void logAuthFlowEvent(eventName, attribution);
        void logAuthFlowEvent("signup_start", attribution);
      }}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[var(--color-k-orange)] px-7 py-3.5 text-center text-[15px] font-extrabold text-[var(--color-k-navy)] shadow-[0_10px_30px_rgba(226,91,18,0.24)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(226,91,18,0.30)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-k-navy)] active:translate-y-0 ${className}`}
    >
      베타 무료로 시작하기
      <ArrowRight aria-hidden="true" className="h-4 w-4" />
    </Link>
  );
}

function SectionHeading({
  eyebrow,
  title,
  children,
  align = "left",
}: {
  eyebrow: string;
  title: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "center";
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-[760px] text-center" : "max-w-[560px]"}>
      <p className="text-xs font-extrabold tracking-[0.18em] text-[var(--color-k-orange)]">{eyebrow}</p>
      <h2 className="mt-3 text-[28px] font-extrabold leading-[1.28] tracking-[-0.03em] text-[var(--color-k-navy)] sm:text-[32px] lg:text-[42px]">
        {title}
      </h2>
      <div className="mt-4 text-base leading-7 text-slate-600 sm:text-[17px]">{children}</div>
    </div>
  );
}

export default function BetaLandingPage({
  preservedParams = {},
}: {
  preservedParams?: PreservedLandingParams;
}) {
  const headerLoginHref = buildPreservedHref("/login?entry=header_login", preservedParams);
  const headerSignupHref = buildPreservedHref("/login?entry=header_signup", preservedParams);
  const viewedSections = useRef(new Set<string>());

  useEffect(() => {
    captureAttribution(preservedParams.link_id ?? null);
  }, [preservedParams.link_id]);

  useEffect(() => {
    const attribution = readAttribution();
    void logAuthFlowEvent("landing_view", attribution);

    const sectionEvents: Record<string, AuthFlowEvent> = {
      "daily-report": "daily_report_view",
      "weekly-report": "weekly_report_view",
      trust: "trust_section_view",
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || viewedSections.current.has(entry.target.id)) continue;
          viewedSections.current.add(entry.target.id);
          const eventName = sectionEvents[entry.target.id];
          if (eventName) void logAuthFlowEvent(eventName, attribution);
        }
      },
      { threshold: 0.35 }
    );

    for (const id of Object.keys(sectionEvents)) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-dvh w-full overflow-x-hidden bg-white text-[var(--color-k-navy)]">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-5 sm:px-6 lg:h-[72px] lg:px-10">
          <Link href="/" aria-label="내친구 케이 홈" className="relative h-8 w-[116px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-500 sm:h-9 sm:w-[132px]">
            <Image src="/Images/logo/Logo.png" alt="내친구 케이" fill priority sizes="132px" className="object-contain object-left" />
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2" aria-label="계정 메뉴">
            <Link
              href={headerLoginHref}
              onClick={() => {
                void logAuthFlowEvent("header_login_clicked", readAttribution());
              }}
              className="flex min-h-11 items-center rounded-full px-3 text-sm font-bold text-[var(--color-k-navy)] focus-visible:outline-2 focus-visible:outline-sky-500 sm:px-4"
            >
              로그인
            </Link>
            <Link
              href={headerSignupHref}
              onClick={() => {
                const attribution = readAttribution();
                void logAuthFlowEvent("header_signup_clicked", attribution);
                void logAuthFlowEvent("signup_start", attribution);
              }}
              className="flex min-h-11 items-center rounded-full border border-[var(--color-k-navy)] px-3 text-sm font-bold text-[var(--color-k-navy)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 sm:px-4"
            >
              회원가입
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden px-5 pb-16 pt-9 sm:px-6 sm:pt-12 lg:px-10 lg:pb-24 lg:pt-16">
          <div aria-hidden="true" className="absolute -right-24 top-6 h-72 w-72 rounded-full bg-sky-100/70 blur-3xl lg:h-[430px] lg:w-[430px]" />
          <div aria-hidden="true" className="absolute -left-32 top-80 h-64 w-64 rounded-full bg-orange-100/60 blur-3xl" />
          <div className="relative mx-auto grid max-w-[1280px] items-center gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
            <div className="mx-auto max-w-[620px] text-center lg:mx-0 lg:text-left">
              <p className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3.5 py-2 text-xs font-extrabold text-sky-800">
                <HeartHandshake aria-hidden="true" className="h-4 w-4" />
                아이와 부모를 이어주는 AI 소통 서비스
              </p>
              <h1 className="mt-5 text-[35px] font-extrabold leading-[1.18] tracking-[-0.045em] text-[var(--color-k-navy)] sm:text-[44px] lg:text-[58px]">
                아이의 오늘은<br />다시 오지 않습니다.
              </h1>
              <p className="mt-5 text-[19px] font-bold leading-[1.55] tracking-[-0.02em] text-slate-700 sm:text-[22px]">
                아이와 매일 소통하며,<br />부모가 아이를 더 잘 이해하도록 돕습니다.
              </p>
              <p className="mx-auto mt-4 max-w-[550px] text-[15px] leading-7 text-slate-600 sm:text-base lg:mx-0">
                아이는 AI 친구 케이와 이야기하고,<br className="sm:hidden" /> 부모는 다음 날 아이의 하루와<br className="sm:hidden" /> 오늘의 대화거리를 받아봅니다.
              </p>
              <div className="mt-7 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center lg:justify-start">
                <LandingPrimaryCta entry="landing_start" eventName="hero_beta_cta_click" className="w-full sm:w-auto" preservedParams={preservedParams} />
                <a
                  href="#daily-report"
                  onClick={() => void logAuthFlowEvent("hero_report_cta_click", readAttribution())}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-extrabold text-[var(--color-k-navy)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
                >
                  리포트 먼저 보기 <ArrowDown aria-hidden="true" className="h-4 w-4" />
                </a>
              </div>
              <p className="mt-3 text-xs font-semibold text-slate-500">초등 자녀 가정 · 베타 기간 무료</p>
            </div>
            <LandingDashboard />
          </div>
        </section>

        <LandingVideoSection
          onPlay={(eventName) => void logAuthFlowEvent(eventName, readAttribution())}
          onComplete={() => void logAuthFlowEvent("landing_video_complete", readAttribution())}
          signupCta={
            <LandingPrimaryCta
              entry="landing_start"
              eventName="landing_video_signup_click"
              className="w-full motion-reduce:transform-none motion-reduce:transition-none"
              preservedParams={preservedParams}
            />
          }
        />

        <section className="bg-[#F8FAFC] px-5 py-16 sm:px-6 sm:py-20 lg:px-10 lg:py-24">
          <div className="mx-auto max-w-[880px] text-center">
            <p className="text-xs font-extrabold tracking-[0.18em] text-[var(--color-k-orange)]">WHY 케이</p>
            <h2 className="mt-3 text-[29px] font-extrabold leading-[1.28] tracking-[-0.03em] text-[var(--color-k-navy)] sm:text-[38px]">
              “오늘 어땠어?”가<br />“그냥”으로 끝난다면
            </h2>
            <div className="mx-auto mt-5 max-w-[720px] space-y-3 text-base leading-7 text-slate-600 sm:text-[17px]">
              <p>아이에게 매일 있었던 일을 모두 설명해 달라고 하기는 어렵습니다. 학교에서 있었던 일, 친구 이야기, 요즘 관심 있는 것을 조금만 알고 있어도 부모와 아이의 대화는 달라질 수 있습니다.</p>
            </div>
            <p className="mt-6 text-lg font-extrabold text-[var(--color-k-navy)]">내친구 케이는 아이의 하루를 부모와의 다음 대화로 연결합니다.</p>
          </div>
        </section>

        <section id="daily-report" className="scroll-mt-20 px-5 py-16 sm:px-6 sm:py-20 lg:px-10 lg:py-28">
          <div className="mx-auto grid max-w-[1280px] items-center gap-9 lg:grid-cols-2 lg:gap-16">
            <div className="lg:order-2">
              <SectionHeading eyebrow="DAILY REPORT" title="오늘 아이에게 어떤 하루가 있었는지, 1분이면 알 수 있습니다.">
                <p>아이가 케이와 나눈 하루의 이야기에서 부모가 알아두면 좋은 내용과 자연스럽게 대화를 이어갈 실마리를 정리합니다.</p>
              </SectionHeading>
              <div className="mt-7 hidden lg:block">
                <LandingPrimaryCta entry="landing_start" eventName="daily_beta_cta_click" preservedParams={preservedParams} />
              </div>
            </div>
            <div className="lg:order-1"><LandingDailyReport /></div>
            <div className="lg:hidden">
              <LandingPrimaryCta entry="landing_start" eventName="daily_beta_cta_click" className="w-full" preservedParams={preservedParams} />
            </div>
          </div>
        </section>

        <section id="weekly-report" className="scroll-mt-20 bg-[#F8FAFC] px-5 py-16 sm:px-6 sm:py-20 lg:px-10 lg:py-28">
          <div className="mx-auto grid max-w-[1280px] items-center gap-9 lg:grid-cols-2 lg:gap-16">
            <SectionHeading eyebrow="WEEKLY REPORT" title={<>하루하루 놓쳤던 이야기를<br />한 주의 흐름으로 볼 수 있습니다.</>}>
              <p>매일의 대화를 바탕으로 이번 주 아이에게 어떤 일이 있었고 어떤 친구·활동·관심사를 자주 이야기했는지 정리합니다.</p>
            </SectionHeading>
            <LandingWeeklyReport />
          </div>
        </section>

        <section className="px-5 py-16 sm:px-6 sm:py-20 lg:px-10 lg:py-28">
          <div className="mx-auto max-w-[1180px]">
            <SectionHeading eyebrow="HOW IT WORKS" title={<>아이는 케이와 이야기하고,<br />부모는 아이와 더 가까워집니다.</>} align="center">
              <p>복잡한 과정 없이, 매일의 작은 이야기가 부모와 아이의 다음 대화로 이어집니다.</p>
            </SectionHeading>
            <ol className="mt-10 grid gap-3 md:grid-cols-3 md:gap-5">
              {HOW_STEPS.map((step) => (
                <li key={step.number} className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_12px_35px_rgba(16,49,91,0.06)] sm:p-6">
                  <span className="text-sm font-extrabold text-[var(--color-k-orange)]">STEP {step.number}</span>
                  <h3 className="mt-3 text-lg font-extrabold text-[var(--color-k-navy)]">{step.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-600">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="trust" className="scroll-mt-20 px-5 pb-16 sm:px-6 sm:pb-20 lg:px-10 lg:pb-28">
          <div className="mx-auto grid max-w-[1120px] items-center gap-8 overflow-hidden rounded-[30px] bg-[var(--color-k-navy)] px-6 py-9 text-white sm:px-10 sm:py-12 lg:grid-cols-[0.7fr_1.3fr] lg:px-14 lg:py-14">
            <div className="flex justify-center">
              <div className="flex h-32 w-32 items-center justify-center rounded-full bg-white/10 sm:h-40 sm:w-40">
                <ShieldCheck aria-hidden="true" className="h-16 w-16 text-sky-300 sm:h-20 sm:w-20" />
              </div>
            </div>
            <div className="text-center lg:text-left">
              <p className="text-xs font-extrabold tracking-[0.14em] text-sky-300">아이의 신뢰를 먼저 생각합니다</p>
              <h2 className="mt-3 text-[28px] font-extrabold leading-tight tracking-[-0.03em] sm:text-[38px]">아이의 이야기는 아이의 것이니까요.</h2>
              <div className="mt-5 space-y-3 text-base leading-7 text-slate-200">
                <p>아이가 케이와 나눈 대화 원문 전체를 부모에게 그대로 보여주지 않습니다.</p>
                <p>부모에게는 아이의 하루를 이해하고 자연스럽게 대화를 시작하는 데 필요한 요약 인사이트를 제공합니다.</p>
              </div>
              <Link href="/privacy" className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-white underline decoration-sky-300 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
                개인정보처리방침 확인하기 <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        <section className="bg-[#FFF8F2] px-5 py-16 text-center sm:px-6 sm:py-20 lg:px-10">
          <div className="mx-auto max-w-[780px]">
            <Sparkles aria-hidden="true" className="mx-auto h-7 w-7 text-[var(--color-k-orange)]" />
            <h2 className="mt-4 text-[28px] font-extrabold leading-tight tracking-[-0.03em] text-[var(--color-k-navy)] sm:text-[38px]">지금 베타 기간 동안 무료로 시작할 수 있습니다.</h2>
            <p className="mt-4 text-base leading-7 text-slate-600">아이와 케이의 작은 대화가 부모와 아이의 다음 대화를 만들어갑니다.</p>
            <div className="mt-7">
              <LandingPrimaryCta entry="landing_start" eventName="beta_cta_click" className="w-full sm:w-auto" preservedParams={preservedParams} />
            </div>
            <p className="mt-3 text-xs font-semibold text-slate-500">초등 자녀 가정 대상</p>
          </div>
        </section>

        <section id="faq" className="px-5 py-16 sm:px-6 sm:py-20 lg:px-10 lg:py-24">
          <div className="mx-auto max-w-[850px]">
            <SectionHeading eyebrow="FAQ" title="자주 묻는 질문" align="center">
              <p>내친구 케이를 시작하기 전에 궁금한 점을 확인해 보세요.</p>
            </SectionHeading>
            <div className="mt-8 divide-y divide-slate-200 border-y border-slate-200">
              {FAQ_ITEMS.map((item, index) => (
                <details
                  key={item.question}
                  className="group py-1"
                  onToggle={(event) => {
                    if (event.currentTarget.open) {
                      void logAuthFlowEvent("faq_open", { ...readAttribution(), item: String(index + 1) });
                    }
                  }}
                >
                  <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-[15px] font-extrabold text-[var(--color-k-navy)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 sm:text-base [&::-webkit-details-marker]:hidden">
                    {item.question}
                    <span aria-hidden="true" className="text-xl font-light text-slate-400 transition-transform group-open:rotate-45">＋</span>
                  </summary>
                  <p className="pb-5 pr-8 text-sm leading-7 text-slate-600 sm:text-[15px]">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="px-5 pb-16 sm:px-6 sm:pb-20 lg:px-10 lg:pb-24">
          <div className="mx-auto max-w-[1050px] overflow-hidden rounded-[30px] bg-sky-50 px-6 py-12 text-center sm:px-10 lg:py-16">
            <MessageCircleMore aria-hidden="true" className="mx-auto h-8 w-8 text-sky-600" />
            <h2 className="mt-4 text-[30px] font-extrabold tracking-[-0.03em] text-[var(--color-k-navy)] sm:text-[42px]">아이의 오늘을 놓치지 마세요.</h2>
            <p className="mt-4 text-base leading-7 text-slate-600">케이와 나눈 작은 대화가<br />부모와 아이의 다음 대화를 만들어갑니다.</p>
            <div className="mt-7">
              <LandingPrimaryCta entry="landing_start" eventName="final_beta_cta_click" className="w-full sm:w-auto" preservedParams={preservedParams} />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-[#F8FAFC] px-5 py-9 sm:px-6 lg:px-10">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="relative h-8 w-[116px]">
              <Image src="/Images/logo/Logo.png" alt="내친구 케이" fill sizes="116px" className="object-contain object-left" />
            </div>
            <p className="mt-2 text-xs text-slate-500">부모와 아이의 다음 대화를 이어주는 AI 소통 서비스</p>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-3 text-xs font-semibold text-slate-600" aria-label="하단 메뉴">
            <a href="#daily-report" className="min-h-11 py-3 underline-offset-4 hover:underline">일간 리포트</a>
            <a href="#weekly-report" className="min-h-11 py-3 underline-offset-4 hover:underline">주간 리포트</a>
            <a href="#faq" className="min-h-11 py-3 underline-offset-4 hover:underline">자주 묻는 질문</a>
            <Link href="/privacy" className="min-h-11 py-3 underline-offset-4 hover:underline">개인정보처리방침</Link>
            {isValidFaqUrl ? (
              <a href={faqUrl} target="_blank" rel="noopener noreferrer" className="min-h-11 py-3 underline-offset-4 hover:underline">문의하기</a>
            ) : (
              <span aria-disabled="true" className="min-h-11 py-3 text-slate-400">문의하기 준비 중</span>
            )}
          </nav>
        </div>
      </footer>
    </div>
  );
}
