"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { icon: "🏠", label: "홈", href: "/child/home" },
  { icon: "🎯", label: "미션", href: "/child/missions" },
  { icon: "💬", label: "대화", href: "/chat" },
  { icon: "🎮", label: "놀이", href: "/child/play" },
  { icon: "⚙️", label: "설정", href: "/child/settings" },
];

export function RealChildNav({ active }: { active: string }) {
  const pathname = usePathname();

  return (
    <div className="shrink-0 flex items-stretch border-t bg-k-surface border-k-border">
      {NAV_ITEMS.map((item) => {
        const isActive =
          item.label === active ||
          pathname === item.href ||
          (item.href === "/chat" && pathname.startsWith("/chat"));
        return (
          <Link
            key={item.label}
            href={item.href}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 select-none cursor-pointer"
          >
            <span className="text-lg" style={{ opacity: isActive ? 1 : 0.55 }}>
              {item.icon}
            </span>
            <span className={`text-[10px] font-bold ${isActive ? "text-k-orange" : "text-k-text-k-sky-blue"}`}>
              {item.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
