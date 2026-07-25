"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV_ITEMS = [
  { icon: "🏠", label: "홈", href: "/parent/home" },
  { icon: "📄", label: "리포트", href: "/parent/report" },
  { icon: "💬", label: "케이와 대화", href: "/parent/guide" },
  { icon: "⚙️", label: "설정", href: "/parent/settings" },
];

export function RealParentNav({ active }: { active?: string }) {
  const pathname = usePathname();
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
    <div className="shrink-0 sticky bottom-0 z-20 flex items-stretch border-t bg-surface border-hairline">
      {NAV_ITEMS.map((item) => {
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
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 select-none cursor-pointer relative"
          >
            {item.label === "케이와 대화" && hasNewQuestion && (
              <span className="absolute top-1.5 right-[calc(50%-12px)] w-2 h-2 bg-danger rounded-full animate-pulse shadow-sm" />
            )}
            <span className="text-lg" style={{ opacity: isActive ? 1 : 0.55 }}>
              {item.icon}
            </span>
            <span className={`text-[10px] font-bold ${isActive ? "text-primary" : "text-muted"}`}>
              {item.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
