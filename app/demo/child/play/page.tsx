"use client";

import Link from "next/link";
import { DemoFrame } from "../../components/DemoFrame";
import { ChildNav } from "../../components/ChildNav";

const GAMES = [
  { icon: "📚", title: "만화책 읽기", bg: "var(--color-k-orange)" },
  { icon: "🧠", title: "퀴즈 게임", bg: "#3b82f6" },
  { icon: "💇", title: "헤어스타일", bg: "var(--color-k-sky-blue)" },
  { icon: "🔮", title: "MBTI 성격 유형", bg: "#22c55e" },
];

export default function DemoChildPlayPage() {
  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#fafaf8" }}>
        <div className="shrink-0 flex items-center justify-center px-4 pt-4 pb-2">
          <Link href="/demo" className="font-bold text-sm cursor-pointer" style={{ color: "var(--color-k-navy)" }}>
            케이와 놀이
          </Link>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          <p className="text-sm text-center mb-5" style={{ color: "#6b7280" }}>
            하고 싶은 놀이를 골라보세요
          </p>

          <div className="grid grid-cols-2 gap-4">
            {GAMES.map((game) => (
              <div
                key={game.title}
                className="flex flex-col items-center justify-center gap-3 rounded-3xl px-4 py-8 shadow-md cursor-default select-none"
                style={{ background: game.bg }}
              >
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center text-4xl"
                  style={{ background: "rgba(255,255,255,0.25)" }}
                >
                  {game.icon}
                </div>
                <p className="text-white font-bold text-sm text-center">{game.title}</p>
              </div>
            ))}
          </div>
        </div>

        <ChildNav active="놀이" />
      </div>
    </DemoFrame>
  );
}
