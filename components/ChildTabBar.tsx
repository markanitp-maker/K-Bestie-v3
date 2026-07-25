"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? "var(--color-k-navy)" : "none"} stroke={active ? "var(--color-k-navy)" : "#9CA3AF"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function ChatIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--color-k-navy)" : "#9CA3AF"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function MissionIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--color-k-navy)" : "#9CA3AF"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

const TABS = [
  { href: "/child/home", label: "홈", Icon: HomeIcon },
  { href: "/child/chat", label: "케이", Icon: ChatIcon },
  { href: "/child/missions", label: "미션", Icon: MissionIcon },
];

export default function ChildTabBar() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 max-w-[480px] mx-auto border-l border-r"
      style={{
        background: "#FFFDF5",
        borderColor: "rgba(26,107,90,0.12)",
        borderTopWidth: "1px",
        height: "64px",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div className="flex items-start justify-around h-full px-4">
        {TABS.map((tab) => {
          const active = pathname === tab.href || (tab.href === "/child/chat" && (pathname === "/chat" || pathname.startsWith("/child/chat")));
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex flex-col items-center gap-0.5 pt-2.5 min-w-[64px]"
            >
              <tab.Icon active={active} />
              <span
                className="text-[11px] font-semibold"
                style={{ color: active ? "var(--color-k-navy)" : "#9CA3AF" }}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
