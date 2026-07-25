"use client";

import Link from "next/link";
import Image from "next/image";
import { DemoFrame } from "../components/DemoFrame";
import { ChildNav } from "../components/ChildNav";

const HOME_CARDS = [
  {
    icon: "🎯",
    title: "미션 진행",
    desc: "오늘의 미션을 시작해요",
    href: "/demo/child/mission",
    bg: "#22c55e",
  },
  {
    icon: "💬",
    title: "대화하기",
    desc: "케이랑 이야기 나눠요",
    href: "/demo/child/chat",
    bg: "var(--color-k-orange)",
  },
  {
    icon: "🎮",
    title: "케이와 놀이",
    desc: "재미있는 놀이를 해봐요",
    href: "/demo/child/play",
    bg: "var(--color-k-sky-blue)",
  },
];

export default function DemoChildHomePage() {
  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--color-k-surface)" }}>
        <div className="shrink-0 flex items-center justify-center px-4 pt-4 pb-2">
          <Link
            href="/demo"
            className="font-bold text-sm cursor-pointer"
            style={{ color: "var(--color-k-navy)" }}
          >
            내친구 케이
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
            />
            <h1 className="text-lg font-bold" style={{ color: "var(--color-k-text-primary)" }}>
              안녕! 오늘은 뭐 하고 놀까?
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
                  <p className="text-white/85 text-xs mt-0.5">{card.desc}</p>
                </div>
                <span className="text-white text-lg">→</span>
              </Link>
            ))}
          </div>
        </div>

        <ChildNav active="홈" />
      </div>
    </DemoFrame>
  );
}
