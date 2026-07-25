"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealParentNav } from "@/components/RealParentNav";
import { ParentHeader } from "@/components/ParentHeader";
import { SkeletonBox } from "@/components/Skeleton";

interface WeeklySummary {
  id: string;
  week_start: string;
  week_end: string;
  summary_text: string;
  detail_text: string;
  detail_dashboard_cards: Record<string, string> | null;
  mood_average: number;
  highlights: string[];
  parent_guide: string;
  weekend_activity_recommendation: string;
}

function formatWeekRange(start: string, end: string): string {
  const s = new Date(start).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
  const e = new Date(end).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
  return `${s} ~ ${e}`;
}

export default function WeeklyReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [weekly, setWeekly] = useState<WeeklySummary | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/parent/reports/weekly/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else {
          setWeekly(d.weeklySummary);
          setRestricted(Boolean(d.restricted));
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <DemoFrame>
        <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
          <ParentHeader />
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonBox key={i} className="h-24" />
            ))}
          </div>
        </div>
      </DemoFrame>
    );
  }

  if (error || !weekly) {
    return (
      <DemoFrame>
        <div className="h-full flex flex-col items-center justify-center px-6 text-center" style={{ background: "#fafaf8" }}>
          <p className="text-sm font-semibold mb-4 text-red-500">{error ?? "주간 리포트를 불러올 수 없어요"}</p>
          <Link href="/parent/report/weekly" className="text-xs underline font-bold" style={{ color: "var(--color-k-navy)" }}>
            목록으로 돌아가기
          </Link>
        </div>
      </DemoFrame>
    );
  }

  const cards = weekly.detail_dashboard_cards ?? {};
  const cardEntries: [string, string][] = (
    [
      ["학교·학원 생활", cards.school_life ?? ""],
      ["친구 관계", cards.peer_relations ?? ""],
      ["관심사", cards.interests ?? ""],
      ["공부 고민", cards.study_concerns ?? ""],
      ["디지털 관심사", cards.digital_interests ?? ""],
      ["미래·진로", cards.future_dreams ?? ""],
      ["반복되는 이야기", cards.recurring_stories ?? ""],
    ] as [string, string][]
  ).filter(([, v]) => v);

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden animate-fade-in" style={{ background: "#f3f4f6" }}>
        <ParentHeader />

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          <p className="text-xs font-bold text-gray-500">{formatWeekRange(weekly.week_start, weekly.week_end)}</p>

          <div className="rounded-2xl px-5 py-5" style={{ background: "#fdf1ec" }}>
            <h3 className="font-bold text-base mb-2" style={{ color: "var(--color-k-text-primary)" }}>
              이번 주 요약
            </h3>
            <p className="text-sm leading-relaxed" style={{ color: "var(--color-k-text-primary)" }}>
              {weekly.summary_text}
            </p>
          </div>

          {weekly.weekend_activity_recommendation && (
            <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
              <h3 className="font-bold text-base mb-2" style={{ color: "var(--color-k-text-primary)" }}>
                🎈 주말 활동 추천
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: "var(--color-k-text-primary)" }}>
                {weekly.weekend_activity_recommendation}
              </p>
            </div>
          )}

          {restricted ? (
            <div className="bg-white rounded-2xl px-5 py-10 shadow-sm flex flex-col items-center text-center">
              <p className="text-4xl mb-3">🔒</p>
              <p className="text-sm font-bold mb-2" style={{ color: "var(--color-k-text-primary)" }}>
                주간 상세는 Care Insight로 업그레이드하세요
              </p>
              <p className="text-xs text-gray-400 mb-5">
                Care Start에서는 주간 요약만 제공돼요. 더 깊은 분석과 부모 가이드는 Insight 이상에서 볼 수 있어요.
              </p>
              <Link
                href="/parent/settings"
                className="px-5 py-2.5 rounded-full text-xs font-bold text-white"
                style={{ background: "var(--color-k-navy)" }}
              >
                요금제 업그레이드
              </Link>
            </div>
          ) : (
            <>
              <div className="bg-white rounded-2xl px-5 py-5 shadow-sm flex flex-col gap-4">
                <h3 className="font-bold text-base -mb-1" style={{ color: "var(--color-k-text-primary)" }}>
                  📄 이번 주 상세 분석
                </h3>
                <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "var(--color-k-text-primary)" }}>
                  {weekly.detail_text || "상세 분석이 준비 중입니다."}
                </p>
              </div>

              {cardEntries.length > 0 && (
                <div className="bg-white rounded-2xl px-5 py-5 shadow-sm flex flex-col gap-4">
                  {cardEntries.map(([title, body]) => (
                    <div key={title} className="border-b border-gray-50 last:border-0 pb-3 last:pb-0">
                      <h4 className="font-bold text-sm mb-1.5" style={{ color: "var(--color-k-text-primary)" }}>
                        {title}
                      </h4>
                      <p className="text-xs leading-relaxed" style={{ color: "#4b5563" }}>
                        {body}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {weekly.parent_guide && (
                <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
                  <h3 className="font-bold text-base mb-2" style={{ color: "var(--color-k-text-primary)" }}>
                    💬 부모님께 드리는 이번 주 가이드
                  </h3>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--color-k-text-primary)" }}>
                    {weekly.parent_guide}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <RealParentNav active="리포트" />
      </div>
    </DemoFrame>
  );
}
