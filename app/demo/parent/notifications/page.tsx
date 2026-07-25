"use client";

import Link from "next/link";
import { DemoFrame } from "../../components/DemoFrame";
import { ParentNav } from "../../components/ParentNav";

const NOTIFICATIONS = [
  { icon: "🎯", text: "아이가 미션을 완료하였습니다", time: "10분 전" },
  { icon: "📄", text: "오늘의 일일 리포트가 생성되었습니다", time: "1시간 전" },
  { icon: "📊", text: "이번 주 주간 리포트가 생성되었습니다", time: "어제" },
];

export default function DemoParentNotificationsPage() {
  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
        <div
          className="shrink-0 flex items-center justify-center px-4 py-4"
          style={{ background: "#fafaf8" }}
        >
          <Link href="/demo" className="font-bold text-sm cursor-pointer" style={{ color: "var(--color-k-navy)" }}>
            알림
          </Link>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          {NOTIFICATIONS.map((n, i) => (
            <div
              key={i}
              className="bg-white rounded-2xl px-4 py-4 shadow-sm flex items-start gap-3"
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0"
                style={{ background: "#fdf1ec" }}
              >
                {n.icon}
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: "var(--color-k-text-primary)" }}>
                  {n.text}
                </p>
                <p className="text-[11px] mt-1" style={{ color: "#6b7280" }}>
                  {n.time}
                </p>
              </div>
            </div>
          ))}
        </div>

        <ParentNav />
      </div>
    </DemoFrame>
  );
}
