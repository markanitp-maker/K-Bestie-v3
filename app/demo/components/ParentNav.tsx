"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { icon: "🏠", label: "홈", href: "/demo/parent" },
  { icon: "📄", label: "리포트", href: "/demo/parent/report" },
  { icon: "💬", label: "케이와 대화", href: "/demo/parent/guide" },
  { icon: "⚙️", label: "설정", href: "/demo/parent/settings" },
];

export function ParentNav() {
  const pathname = usePathname() ?? "";

  return (
    <div
      className="shrink-0 flex items-stretch border-t"
      style={{ background: "#ffffff", borderColor: "#f3f4f6" }}
    >
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href.split("#")[0];
        return (
          <Link
            key={item.label}
            href={item.href}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 select-none"
          >
            <span className="text-lg" style={{ opacity: active ? 1 : 0.55 }}>
              {item.icon}
            </span>
            <span
              className="text-[10px] font-bold"
              style={{ color: active ? "var(--color-k-navy)" : "#6b7280" }}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
