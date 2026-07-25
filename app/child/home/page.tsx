"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealChildNav } from "@/components/RealChildNav";

type ChildInfo = { id: string; name: string; grade: string };

// 대표님 지시(2026-07-25): 아이 홈 주요 액션 카드는 화면 하나의 하드코딩이 아니라
// "child action card" variant 체계로 관리한다 — 카드마다 기능적 의미가 다르므로
// (미션=가장 강한 CTA, 대화=더 부드럽고 따뜻한 톤, 놀이=차분한 정보색) 색을 구분한다.
// 새 CSS 변수/디자인 스킬 파일은 건드리지 않고, 이미 globals.css에 존재하는
// v2.0 토큰(--color-k-orange/--color-k-mascot-orange/--color-k-sky-blue)만 참조한다.
// hover/pressed는 새 색상 토큰을 추가하는 대신 brightness 필터(다크모드·터치 모두 안전)로
// 표현해 이번 변경이 globals.css/스킬 파일 확장 없이 프로젝트 코드만으로 완결되게 했다.
type ChildActionCardVariant = "primary" | "warm" | "info";

const CHILD_ACTION_CARD_VARIANTS: Record<
  ChildActionCardVariant,
  { bg: string; badgeBg: string }
> = {
  // 미션 진행 — 가장 강한 CTA. K-Orange 그대로 유지.
  primary: { bg: "var(--color-k-orange)", badgeBg: "rgba(255,255,255,0.25)" },
  // 대화하기 — 미션과 같은 주황을 쓰지 않고 K-Mascot-Orange 기반의 더 부드럽고
  // 따뜻한 톤으로 분리(미션 카드와 한눈에 다른 성격으로 인지되도록).
  warm: { bg: "var(--color-k-mascot-orange)", badgeBg: "rgba(255,255,255,0.28)" },
  // 케이와 놀이 — K-Sky-Blue 유지.
  info: { bg: "var(--color-k-sky-blue)", badgeBg: "rgba(255,255,255,0.25)" },
};

const HOME_CARDS: Array<{
  icon: string;
  title: string;
  desc: string;
  href: string;
  variant: ChildActionCardVariant;
}> = [
  {
    icon: "🎯",
    title: "미션 진행",
    desc: "오늘의 미션을 시작해요",
    href: "/child/missions",
    variant: "primary",
  },
  {
    icon: "💬",
    title: "대화하기",
    desc: "케이랑 이야기 나눠요",
    href: "/chat",
    variant: "warm",
  },
  {
    icon: "🎮",
    title: "케이와 놀이",
    desc: "재미있는 놀이를 해봐요",
    href: "/child/play",
    variant: "info",
  },
];

const getFriendlyName = (fullName: string): string => {
  if (!fullName) return "";
  // 성을 제외한 이름만 추출 (2글자 이상이면 첫 글자 성 1자를 제외)
  const nameOnly = fullName.length > 1 ? fullName.substring(1) : fullName;

  // 받침 유무에 따른 호격조사 '아'/'야' 판별
  const lastChar = nameOnly.charCodeAt(nameOnly.length - 1);
  if (lastChar >= 0xac00 && lastChar <= 0xd7a3) {
    const hasBatchim = (lastChar - 0xac00) % 28 > 0;
    return `${nameOnly}${hasBatchim ? "아" : "야"}`;
  }
  return nameOnly;
};

export default function ChildHomePage() {
  const [child, setChild] = useState<ChildInfo | null>(null);
  const [goldKeyBalance, setGoldKeyBalance] = useState<number | null>(null);
  const [noChild, setNoChild] = useState(false);
  const [loading, setLoading] = useState(true);
  // A~F 대화방식 테스트 진입 버튼은 테스트 계정(is_test_account=true)에만 노출.
  // 서버가 /api/child/test-mode 에서 재검증하므로, 200이면 테스트 계정 → 버튼 표시.
  const [isTestAccount, setIsTestAccount] = useState(false);

  useEffect(() => {
    // 1. /api/child/me를 호출하여 세션 기반의 아이 프로필 확인
    fetch("/api/child/me")
      .then(async (r) => {
        if (r.ok) {
          const data = await r.json();
          if (data && data.id) {
            setChild(data);
            localStorage.setItem("k_child_id", data.id);
            return true;
          }
        }
        return false;
      })
      .then((success) => {
        if (success) {
          setLoading(false);
          return;
        }

        // 2. 세션에 없으면 기존 localStorage 및 ID 매핑 폴백
        const id = localStorage.getItem("k_child_id");
        if (!id) {
          setNoChild(true);
          setLoading(false);
          return;
        }
        fetch(`/api/child/${encodeURIComponent(id)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data) setChild(data);
            else setNoChild(true);
          })
          .catch(() => setNoChild(true))
          .finally(() => setLoading(false));
      })
      .catch(() => {
        setNoChild(true);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!child?.id) return;
    fetch(`/api/goldkey/balance?childId=${child.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setGoldKeyBalance(data.balance); })
      .catch(() => {});
  }, [child?.id]);

  useEffect(() => {
    // 테스트 계정 여부 서버 재검증(일반 계정은 403 → 버튼 미노출).
    fetch("/api/child/test-mode")
      .then((r) => setIsTestAccount(r.status === 200))
      .catch(() => setIsTestAccount(false));
  }, []);

  const handleLogout = async () => {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    await supabase.auth.signOut();
    localStorage.removeItem("k_child_id");
    localStorage.removeItem("login_role");
    window.location.href = "/login?role=child";
  };

  if (loading) {
    return (
      <DemoFrame>
        <div className="h-full flex items-center justify-center bg-k-background">
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-k-orange) var(--color-k-orange) transparent transparent" }} />
        </div>
      </DemoFrame>
    );
  }

  if (noChild) {
    return (
      <DemoFrame>
        <div className="h-full flex flex-col items-center justify-center px-6 py-8 text-center bg-k-background">
          <div className="max-w-md w-full bg-k-surface rounded-3xl p-8 shadow-md border border-k-orange/10">
            <p className="text-5xl mb-4">🌱</p>
            <p className="text-lg font-bold text-k-text-k-orange">가족 연결이 필요해요</p>
            <p className="text-xs mt-3 leading-relaxed text-k-text-k-sky-blue">
              현재 로그인한 구글 계정이 가족에 등록되어 있지 않습니다.
              <br />
              부모님 앱에서 아이 추가 화면을 통해 이메일을 예약 등록했는지 확인해 주세요.
            </p>

            <button
              onClick={handleLogout}
              className="w-full py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform mt-6 cursor-pointer bg-k-orange"
            >
              로그아웃 후 다시 로그인하기
            </button>
          </div>
        </div>
      </DemoFrame>
    );
  }

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden bg-k-background">
        <div className="shrink-0 flex items-center justify-center px-4 pt-4 pb-2">
          <Link href="/child/home" className="cursor-pointer">
            <Image
              src="/Images/logo/Logo.png"
              alt="내친구 케이"
              width={84}
              height={24}
              className="object-contain"
              priority
            />
          </Link>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          <div className="flex flex-col items-center text-center mb-6">
            <Image
              src="/Images/mascot/mascot-standing.png"
              alt="케이 마스코트"
              width={96}
              height={96}
              className="object-contain mb-2"
              priority
            />
            <h1 className="text-lg font-bold text-k-text-k-orange">
              {child ? `안녕, ${getFriendlyName(child.name)}! 오늘은 뭐 하고 놀까?` : "안녕! 오늘은 뭐 하고 놀까?"}
            </h1>
            <p className="text-xs mt-1 text-k-text-k-sky-blue">
              케이랑 같이 재미있게 보내봐요
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {HOME_CARDS.map((card) => {
              const variantStyle = CHILD_ACTION_CARD_VARIANTS[card.variant];
              return (
              <Link
                key={card.title}
                href={card.href}
                className="flex items-center gap-4 rounded-3xl px-5 py-5 shadow-md transition-all active:scale-[0.98] hover:brightness-95 active:brightness-90"
                style={{ background: variantStyle.bg }}
              >
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0"
                  style={{ background: variantStyle.badgeBg }}
                >
                  {card.icon}
                </div>
                <div className="flex-1 text-left">
                  <p className="text-white font-bold text-base">{card.title}</p>
                  <p className="text-white/85 text-xs mt-0.5">
                    {card.desc}
                    {card.href === "/child/play" && goldKeyBalance !== null && (
                      <span className="ml-1.5 font-bold">· 🔑 {goldKeyBalance}개 보유</span>
                    )}
                  </p>
                </div>
                <span className="text-white text-lg">→</span>
              </Link>
              );
            })}

            {isTestAccount && (
              <Link
                href="/child/test-modes"
                className="flex items-center gap-4 rounded-3xl px-5 py-5 shadow-md transition-transform active:scale-[0.98] border-2 border-dashed bg-k-surface border-k-orange"
              >
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0 bg-k-orange-tint">
                  🧪
                </div>
                <div className="flex-1 text-left">
                  <p className="font-bold text-base text-k-orange">대화 방식 테스트</p>
                  <p className="text-xs mt-0.5 text-k-text-k-sky-blue">A~F 방식 선택 (테스트 계정 전용)</p>
                </div>
                <span className="text-lg text-k-orange">→</span>
              </Link>
            )}
          </div>
        </div>

        <RealChildNav active="홈" />
      </div>
    </DemoFrame>
  );
}
