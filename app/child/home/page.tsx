"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealChildNav } from "@/components/RealChildNav";

type ChildInfo = { id: string; name: string; grade: string };

const HOME_CARDS = [
  {
    icon: "🎯",
    title: "미션 진행",
    desc: "오늘의 미션을 시작해요",
    href: "/child/missions",
    bg: "#22c55e",
  },
  {
    icon: "💬",
    title: "대화하기",
    desc: "케이랑 이야기 나눠요",
    href: "/chat",
    bg: "#e8845a",
  },
  {
    icon: "🎮",
    title: "케이와 놀이",
    desc: "재미있는 놀이를 해봐요",
    href: "/child/play",
    bg: "#2d9f8f",
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
        <div className="h-full flex items-center justify-center" style={{ background: "#fafaf8" }}>
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#1a6b5a #1a6b5a transparent transparent" }} />
        </div>
      </DemoFrame>
    );
  }

  if (noChild) {
    return (
      <DemoFrame>
        <div
          className="h-full flex flex-col items-center justify-center px-6 py-8 text-center"
          style={{ background: "#fafaf8" }}
        >
          <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-md border border-emerald-500/10">
            <p className="text-5xl mb-4">🌱</p>
            <p className="text-lg font-bold text-gray-800">가족 연결이 필요해요</p>
            <p className="text-xs mt-3 leading-relaxed text-gray-500">
              현재 로그인한 구글 계정이 가족에 등록되어 있지 않습니다.
              <br />
              부모님 앱에서 아이 추가 화면을 통해 이메일을 예약 등록했는지 확인해 주세요.
            </p>

            <button
              onClick={handleLogout}
              className="w-full py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform mt-6 cursor-pointer"
              style={{ background: "#1a6b5a" }}
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
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#fafaf8" }}>
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
            <h1 className="text-lg font-bold" style={{ color: "#1e1e2d" }}>
              {child ? `안녕, ${getFriendlyName(child.name)}! 오늘은 뭐 하고 놀까?` : "안녕! 오늘은 뭐 하고 놀까?"}
            </h1>
            <p className="text-xs mt-1" style={{ color: "#6b7280" }}>
              케이랑 같이 재미있게 보내봐요
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {HOME_CARDS.map((card) => (
              <Link
                key={card.title}
                href={card.href}
                className="flex items-center gap-4 rounded-3xl px-5 py-5 shadow-md transition-transform active:scale-[0.98]"
                style={{ background: card.bg }}
              >
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0"
                  style={{ background: "rgba(255,255,255,0.25)" }}
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
            ))}

            {isTestAccount && (
              <Link
                href="/child/test-modes"
                className="flex items-center gap-4 rounded-3xl px-5 py-5 shadow-md transition-transform active:scale-[0.98] border-2 border-dashed"
                style={{ background: "#fff", borderColor: "#1a6b5a" }}
              >
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0"
                  style={{ background: "rgba(26,107,90,0.12)" }}
                >
                  🧪
                </div>
                <div className="flex-1 text-left">
                  <p className="font-bold text-base" style={{ color: "#1a6b5a" }}>대화 방식 테스트</p>
                  <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>A~F 방식 선택 (테스트 계정 전용)</p>
                </div>
                <span className="text-lg" style={{ color: "#1a6b5a" }}>→</span>
              </Link>
            )}
          </div>
        </div>

        <RealChildNav active="홈" />
      </div>
    </DemoFrame>
  );
}
