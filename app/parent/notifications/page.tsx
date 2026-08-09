"use client";

import Link from "next/link";
import Image from "next/image";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealParentNav } from "@/components/RealParentNav";
import KChatbotWidget from "@/components/KChatbotWidget";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";

export default function ParentNotificationsPage() {
  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
        {/* 헤더 */}
        <div
          className="shrink-0 flex items-center justify-between px-4 py-4"
          style={{ background: "var(--color-k-surface)" }}
        >
          <Link href="/parent/home" className="text-lg cursor-pointer" aria-label="뒤로가기">
            ←
          </Link>
          <Image
            src="/Images/logo/Logo.png"
            alt="내친구 케이"
            width={84}
            height={24}
            className="object-contain"
            priority
          />
          <div className="h-11 w-11" aria-hidden />
        </div>
        <NotificationCenter />

        <RealParentNav />
      </div>
    
        <KChatbotWidget appSurface="parent" />
      </DemoFrame>
  );
}
