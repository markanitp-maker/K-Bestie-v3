"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealParentNav } from "@/components/RealParentNav";
import { ParentHeader } from "@/components/ParentHeader";
import { SkeletonBox } from "@/components/Skeleton";
import { useStore } from "@/hooks/useStore";

interface WeeklySummary {
  id: string;
  week_start: string;
  week_end: string;
  summary_text: string;
  mood_average: number;
  highlights: string[];
  weekend_activity_recommendation: string;
}

function formatWeekRange(start: string, end: string): string {
  const s = new Date(start).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
  const e = new Date(end).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
  return `${s} ~ ${e}`;
}

export default function ParentWeeklyReportPage() {
  const store = useStore();
  const activeChildId = store.activeChildId ?? store.children[0]?.id ?? null;
  const [weeklies, setWeeklies] = useState<WeeklySummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeChildId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`/api/parent/reports/weekly?childId=${activeChildId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setWeeklies(d?.weeklySummaries ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeChildId]);

  if (loading) {
    return (
      <DemoFrame>
        <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
          <ParentHeader />
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonBox key={i} className="h-28" />
            ))}
          </div>
        </div>
      </DemoFrame>
    );
  }

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
        <ParentHeader />

        <div className="flex items-center gap-2 px-4 pt-3">
          <Link href="/parent/report" className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white text-gray-500">
            일간
          </Link>
          <span className="text-xs font-bold px-3 py-1.5 rounded-full text-white" style={{ background: "var(--color-k-navy)" }}>
            주간
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          {weeklies.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl shadow-sm">
              <p className="text-4xl mb-4">📭</p>
              <p className="text-sm font-semibold text-gray-600">아직 주간 리포트가 없어요</p>
              <p className="text-xs mt-2 text-gray-400">매주 토요일에 새로 생성돼요</p>
            </div>
          ) : (
            weeklies.map((w) => (
              <Link
                key={w.id}
                href={`/parent/report/weekly/${w.id}`}
                className="block bg-white rounded-2xl p-4 active:scale-[0.99] transition-transform shadow-sm"
              >
                <p className="text-xs font-bold text-gray-500 mb-2">{formatWeekRange(w.week_start, w.week_end)}</p>
                <p className="text-sm font-bold text-gray-800 leading-relaxed mb-2">{w.summary_text}</p>
                <div className="flex gap-1.5 flex-wrap mb-2">
                  {(w.highlights ?? []).slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                      style={{ background: "#fdf1ec", color: "var(--color-k-orange)" }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                {w.weekend_activity_recommendation && (
                  <p className="text-xs leading-relaxed" style={{ color: "var(--color-k-navy)" }}>
                    🎈 {w.weekend_activity_recommendation}
                  </p>
                )}
              </Link>
            ))
          )}
        </div>

        <RealParentNav active="리포트" />
      </div>
    </DemoFrame>
  );
}
