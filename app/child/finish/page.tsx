"use client";

import Link from "next/link";
import { useStore } from "@/hooks/useStore";

export default function ChildFinishPage() {
  const store = useStore();
  const missions = store.missions;
  const completedCount = missions.filter((m) => m.completed).length;
  const lastCompleted = missions.filter((m) => m.completed).at(-1);

  return (
    <div
      className="min-h-dvh pb-[72px] flex flex-col max-w-[480px] mx-auto shadow-sm"
      style={{ background: "var(--color-child-bg)", fontFamily: "var(--font-child)" }}
    >
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="text-7xl mb-4 animate-bounce">🎉</div>
        <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--color-k-orange)" }}>
          오늘도 잘했어!
        </h1>
        <p className="text-base font-semibold text-gray-700 mb-1">
          케이랑 같이 멋지게 해냈어 ✨
        </p>
        <p className="text-sm" style={{ color: "var(--color-text-k-text-k-sky-blue)" }}>
          오늘 미션 {completedCount}개 완료!
        </p>

        {store.moodScore !== null && (
          <div
            className="mt-4 px-5 py-3 rounded-2xl"
            style={{ background: "white", boxShadow: "0 2px 12px rgba(26,107,90,0.10)" }}
          >
            <p className="text-sm font-bold" style={{ color: "var(--color-k-orange)" }}>
              오늘 기분: {"⭐".repeat(store.moodScore)} ({store.moodScore}점)
            </p>
          </div>
        )}

        {lastCompleted && (
          <div
            className="mt-5 w-full max-w-xs rounded-2xl p-4 flex items-center gap-3"
            style={{ background: "white", boxShadow: "0 2px 16px rgba(26,107,90,0.10)" }}
          >
            <span className="text-3xl">{lastCompleted.emoji}</span>
            <div className="text-left flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-800 truncate">{lastCompleted.title}</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-text-k-text-k-sky-blue)" }}>
                미션 완료 🌟
              </p>
            </div>
            <span className="text-xl">✅</span>
          </div>
        )}

        <div className="mt-8 flex flex-col gap-3 w-full max-w-xs">
          <Link
            href="/child/chat"
            className="block text-center py-4 rounded-2xl font-bold text-white text-sm"
            style={{ background: "var(--color-k-orange)" }}
          >
            🌿 케이와 더 대화하기
          </Link>
          <Link
            href="/child/home"
            className="block text-center py-3 rounded-2xl font-semibold text-sm border"
            style={{
              borderColor: "rgba(26,107,90,0.25)",
              color: "var(--color-k-orange)",
              background: "rgba(26,107,90,0.04)",
            }}
          >
            홈으로 돌아가기
          </Link>
        </div>
      </div>

    </div>
  );
}
