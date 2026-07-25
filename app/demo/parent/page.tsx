"use client";

import Link from "next/link";
import { DemoFrame } from "../components/DemoFrame";
import { useDemoView } from "../components/DemoViewContext";
import { ParentNav } from "../components/ParentNav";
import { demoProfile, dashboardCards } from "../lib/mockData";

export default function DemoParentDashboardPage() {
  const { view } = useDemoView();
  const gridCols = view === "tablet" ? "grid-cols-4" : "grid-cols-2";

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
        {/* 헤더 */}
        <div
          className="shrink-0 flex items-center justify-between px-4 py-4"
          style={{ background: "#fafaf8" }}
        >
          <span className="w-5" />
          <Link
            href="/demo"
            className="font-bold text-sm cursor-pointer"
            style={{ color: "var(--color-k-navy)" }}
          >
            내친구 케이
          </Link>
          <Link href="/demo/parent/notifications" className="text-lg" aria-label="알림">
            🔔
          </Link>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-8">
          {/* 프로필 카드 */}
          <div className="flex items-center justify-between bg-white rounded-2xl px-4 py-4 shadow-sm mb-6">
            <div className="flex items-center gap-3">
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center text-lg"
                style={{ background: "#f3f4f6" }}
              >
                🧒
              </div>
              <div>
                <p className="font-bold text-sm" style={{ color: "var(--color-k-text-primary)" }}>
                  {demoProfile.name}
                </p>
                <p className="text-xs" style={{ color: "#6b7280" }}>
                  ({demoProfile.grade}, {demoProfile.age}세)
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px]" style={{ color: "#6b7280" }}>
                최근 대화일
              </p>
              <p className="text-xs font-bold" style={{ color: "var(--color-k-text-primary)" }}>
                {demoProfile.lastChatDate}
              </p>
            </div>
          </div>

          <h2 className="text-base font-bold mb-3" style={{ color: "var(--color-k-text-primary)" }}>
            아이 현황 보기
          </h2>

          <div className={`grid ${gridCols} gap-3 mb-8`}>
            {dashboardCards.map((card, i) => (
              <div key={i} className="bg-white rounded-2xl px-4 py-4 shadow-sm">
                <div className="text-xl mb-2">{card.icon}</div>
                <p className="text-[11px] mb-1" style={{ color: "#6b7280" }}>
                  {card.title}
                </p>
                <p className="text-sm font-bold" style={{ color: "var(--color-k-text-primary)" }}>
                  {card.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        <ParentNav />
      </div>
    </DemoFrame>
  );
}
