"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FileText, Home, MessageCircle, Settings } from "lucide-react";

const NAV_ITEMS = [
  { icon: Home, label: "홈", href: "/parent/home" },
  { icon: FileText, label: "리포트", href: "/parent/report" },
  { icon: MessageCircle, label: "케이와 대화", href: "/parent/guide" },
  { icon: Settings, label: "설정", href: "/parent/settings" },
];

export function RealParentNav({ active }: { active?: string }) {
  const pathname = usePathname() ?? "";
  const [hasNewQuestion, setHasNewQuestion] = useState(false);

  useEffect(() => {
    const checkNewQuestions = async () => {
      const id = localStorage.getItem("k_child_id");
      if (!id) return;
      
      try {
        const res = await fetch(`/api/parent/questions?childId=${id}`);
        if (!res.ok) return;
        const data = await res.json();
        const questions = data.questions || [];
        
        const saved = localStorage.getItem("k_question_statuses");
        let prevStatuses: Record<string, string> = {};
        if (saved) {
          try {
            prevStatuses = JSON.parse(saved);
          } catch (e) {}
        }
        
        let hasNew = false;
        // Only show NEW badge if there is at least one previously viewed item
        // to avoid showing badge for the first time user without any actions,
        // or optionally always show if there's any new.
        if (Object.keys(prevStatuses).length > 0) {
          for (const q of questions) {
            if (!prevStatuses[q.id] || prevStatuses[q.id] !== q.status) {
              hasNew = true;
              break;
            }
          }
        }
        setHasNewQuestion(hasNew);
      } catch (e) {}
    };

    checkNewQuestions();

    const handleQuestionsViewed = () => {
      setHasNewQuestion(false);
    };
    window.addEventListener("questions_viewed", handleQuestionsViewed);
    return () => window.removeEventListener("questions_viewed", handleQuestionsViewed);
  }, [pathname]);

  return (
    <nav className="sticky bottom-0 z-20 flex shrink-0 items-stretch border-t border-k-border bg-k-surface pb-[env(safe-area-inset-bottom)]" aria-label="부모 주요 메뉴">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive =
          item.label === active ||
          pathname === item.href ||
          (item.href === "/parent/report" && pathname.startsWith("/parent/report")) ||
          (item.href === "/parent/guide" && pathname.startsWith("/parent/guide")) ||
          (item.href === "/parent/settings" && pathname.startsWith("/parent/settings"));

        return (
          <Link
            key={item.label}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`relative flex min-h-[88px] flex-1 cursor-pointer select-none flex-col items-center justify-center gap-2 px-2 pb-2.5 pt-3 ${isActive ? "text-k-navy" : "text-[var(--color-k-text-secondary)]"}`}
          >
            {isActive && <span className="absolute inset-x-4 top-0 h-1 rounded-b-full bg-k-navy" aria-hidden="true" />}
            {item.label === "케이와 대화" && hasNewQuestion && (
              <span className="absolute right-[calc(50%-18px)] top-2 h-2.5 w-2.5 animate-pulse rounded-full bg-k-danger shadow-sm" />
            )}
            <Icon className="h-[30px] w-[30px] shrink-0" strokeWidth={isActive ? 2.7 : 2.2} aria-hidden="true" />
            <span className={`text-[clamp(12.5px,3.6vw,14px)] font-extrabold leading-none whitespace-nowrap ${isActive ? "text-k-navy" : "text-[var(--color-k-text-secondary)]"}`}>
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
