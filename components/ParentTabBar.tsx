"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/hooks/useStore";
import { unreadCount } from "@/lib/store";

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? "#5B5BD6" : "none"} stroke={active ? "#5B5BD6" : "#9CA3AF"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function ReportIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#5B5BD6" : "#9CA3AF"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function BellIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#5B5BD6" : "#9CA3AF"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function SettingsIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#5B5BD6" : "#9CA3AF"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

import Image from "next/image";

const TABS = [
  { href: "/parent/home", label: "홈", Icon: HomeIcon },
  { href: "/parent/report", label: "리포트", Icon: ReportIcon },
  { href: "/parent/notifications", label: "알림", Icon: BellIcon, isNotif: true },
  { href: "/parent/settings", label: "설정", Icon: SettingsIcon },
];

export default function ParentTabBar() {
  const pathname = usePathname();
  const store = useStore();

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const badge = mounted ? unreadCount(store) : 0;

  return (
    <>
      {/* 1. 모바일 & 태블릿용 하단 탭바 */}
      <nav className="parent-tab-bar">
        <div className="flex items-start justify-around h-full px-1">
          {TABS.map((tab) => {
            const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
            const showBadge = tab.isNotif && badge > 0 && !active;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className="flex flex-col items-center gap-0.5 pt-3 min-w-[60px]"
              >
                <div className="relative">
                  <tab.Icon active={active} />
                  {showBadge && (
                    <span className="absolute -top-1 -right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                      {badge > 9 ? "9+" : badge}
                    </span>
                  )}
                </div>
                <span
                  className="text-[11px] font-medium"
                  style={{ color: active ? "#5B5BD6" : "#9CA3AF" }}
                >
                  {tab.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* 2. PC 데스크톱용 좌측 고정 사이드바 */}
      <aside className="parent-sidebar">
        {/* 서비스 로고 및 이름 */}
        <div className="flex items-center gap-2.5 mb-10 px-1">
          <Image
            src="/character_logo.png"
            alt="케이"
            width={34}
            height={34}
            className="rounded-full object-cover"
          />
          <div>
            <h1 className="text-sm font-bold text-gray-900 leading-none">내친구 케이</h1>
            <p className="text-[10px] text-gray-400 mt-1.5">보호자 대시보드</p>
          </div>
        </div>

        {/* 메뉴 리스트 */}
        <div className="flex flex-col gap-1.5 flex-1">
          {TABS.map((tab) => {
            const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
            const showBadge = tab.isNotif && badge > 0;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className="flex items-center gap-3.5 px-4 py-3 rounded-2xl transition-all duration-200"
                style={{
                  background: active ? "var(--color-k-navy-tint)" : "transparent",
                  color: active ? "var(--color-k-navy)" : "#4B5563",
                }}
              >
                <div className="relative shrink-0 flex items-center">
                  <tab.Icon active={active} />
                  {showBadge && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full" />
                  )}
                </div>
                <span className="text-sm font-semibold flex-1">{tab.label}</span>
                {showBadge && (
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-red-100 text-red-600">
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {/* 하단 데일리 팁 */}
        <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100/60 mt-auto">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">오늘의 소통 가이드</p>
          <p className="text-xs text-gray-600 leading-relaxed">
            아이의 감정 점수가 낮은 날에는 훈계하기보다, "오늘 마음 아픈 일 있었어?"라며 편안히 공감해 주세요. 💬
          </p>
        </div>
      </aside>
    </>
  );
}

