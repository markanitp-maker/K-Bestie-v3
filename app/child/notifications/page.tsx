"use client";

import Link from "next/link";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";

export default function ChildNotificationsPage() {
  return (
    <DemoFrame>
      <div className="flex h-full flex-col overflow-hidden bg-[#f3f4f6]">
        <header className="flex shrink-0 items-center justify-between bg-white px-4 py-4">
          <Link href="/child/home" className="flex h-11 w-11 items-center justify-center rounded-xl text-xl" aria-label="홈으로 돌아가기">←</Link>
          <h1 className="text-base font-extrabold text-[#172A46]">이벤트 및 알림</h1>
          <span className="h-11 w-11" aria-hidden />
        </header>
        <NotificationCenter />
      </div>
    </DemoFrame>
  );
}
