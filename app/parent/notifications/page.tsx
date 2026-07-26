"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealParentNav } from "@/components/RealParentNav";
import { useStore } from "@/hooks/useStore";
import { markNotifRead, markAllNotifsRead } from "@/lib/store";
import KChatbotWidget from "@/components/KChatbotWidget";

function getNotifIcon(title: string): string {
  if (title.includes("미션")) return "🎯";
  if (title.includes("일일")) return "📄";
  if (title.includes("주간")) return "📊";
  return "🔔";
}

export default function ParentNotificationsPage() {
  const store = useStore();
  const notifs = store.notifications;
  const unread = notifs.filter((n) => !n.read).length;

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <DemoFrame>
        <div className="h-full flex items-center justify-center" style={{ background: "var(--color-k-surface)" }}>
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-k-navy) var(--color-k-navy) transparent transparent" }} />
        </div>
      </DemoFrame>
    );
  }

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
          <div className="flex items-center gap-1.5 select-none">
            {unread > 0 ? (
              <button
                onClick={markAllNotifsRead}
                className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white cursor-pointer active:scale-95 transition-transform"
                style={{ background: "var(--color-k-orange)" }}
              >
                모두 읽음 ({unread})
              </button>
            ) : (
              <span className="text-[10px] text-gray-400 font-bold px-2 py-0.5 bg-gray-150 rounded-full border border-gray-200">
                모두 읽음 ✓
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          {notifs.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-2xl shadow-sm">
              <p className="text-5xl mb-4">🔔</p>
              <p className="text-sm font-semibold text-gray-500">새로운 알림이 없어요</p>
            </div>
          ) : (
            notifs.map((notif) => {
              const icon = getNotifIcon(notif.title);
              return (
                <div
                  key={notif.id}
                  onClick={() => markNotifRead(notif.id)}
                  className={`bg-white rounded-2xl px-4 py-4 shadow-sm flex items-start gap-3 transition-opacity cursor-pointer ${
                    notif.read ? "opacity-60" : "opacity-100"
                  }`}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0 select-none"
                    style={{ background: notif.read ? "#f3f4f6" : "#fdf1ec" }}
                  >
                    {icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold truncate text-gray-800">
                        {notif.title}
                      </p>
                      {!notif.read && (
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                      {notif.body}
                    </p>
                    <p className="text-[10px] mt-1" style={{ color: "#6b7280" }}>
                      {notif.time}
                    </p>
                    {notif.hasExpertCTA && !notif.read && (
                      <Link
                        href="/parent/expert"
                        onClick={(e) => e.stopPropagation()}
                        className="mt-2.5 inline-block px-3.5 py-1.5 rounded-full text-[10px] font-bold text-white shadow-sm transition-transform active:scale-95"
                        style={{ background: "var(--color-k-orange)" }}
                      >
                        전문가와 연결하기 →
                      </Link>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <RealParentNav />
      </div>
    
        <KChatbotWidget appSurface="parent" />
      </DemoFrame>
  );
}
