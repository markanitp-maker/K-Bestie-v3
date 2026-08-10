import React from "react";
import { formatWeekRange } from "./CurrentWeekAggregationCard";

export interface WeeklyReportSummary {
  id: string;
  week_start: string;
  week_end: string;
  summary_text: string;
  mood_average: number | null;
  highlights: string[];
  summary_state: string;
  parent_guide?: string | null;
}

export function getStateColor(state: string) {
  if (state === "살펴볼 점이 있어요") return "var(--color-k-mascot-orange)";
  if (state === "편안한 한 주였어요") return "var(--color-k-sky-blue)";
  return "#9CA3AF"; // Neutral (평소와 비슷했어요 or 데이터가 아직 적어요)
}

export function WeeklyReportCard({
  report,
  isFeatured = false,
  isLastWeek = false,
  onClick
}: {
  report: WeeklyReportSummary;
  isFeatured?: boolean;
  isLastWeek?: boolean;
  onClick?: (e: React.MouseEvent, id: string) => void;
}) {
  return (
    <button
      onClick={(e) => onClick?.(e, report.id)}
      className={`flex w-full flex-col justify-between rounded-[24px] border border-gray-200 bg-white p-5 text-left transition-transform active:scale-[0.99] sm:p-6 ${
        isFeatured ? "mb-6 shadow-md" : "h-full min-h-[260px] shadow-sm"
      }`}
    >
      <div>
        <div className="mb-5 flex items-start justify-between gap-3">
          <h2 className="text-xl font-extrabold leading-7 text-[var(--color-k-navy)] sm:text-2xl">
            {formatWeekRange(report.week_start, report.week_end)}
          </h2>
          {isFeatured && isLastWeek && (
            <span className="shrink-0 rounded-full px-3 py-1.5 text-[13px] font-extrabold text-white" style={{ background: "var(--color-k-mascot-orange)" }}>
              지난 완료 주간
            </span>
          )}
        </div>
        
        <section className="mb-5" aria-label="이번 주 핵심 요약">
          <h3 className="mb-2 text-lg font-extrabold text-[var(--color-k-navy)]">이번 주 핵심 요약</h3>
          <p className="line-clamp-2 whitespace-pre-line break-words text-lg font-semibold leading-8 text-gray-800">
            {report.summary_text || "주간 요약이 없습니다."}
          </p>
        </section>

        {report.parent_guide && (
          <section className="mb-5 border-t border-gray-100 pt-5" aria-label="부모 확인사항">
            <h3 className="mb-2 text-lg font-extrabold text-[var(--color-k-navy)]">부모가 알아두면 좋은 점</h3>
            <p className="whitespace-pre-line break-words text-base leading-7 text-gray-700">{report.parent_guide}</p>
          </section>
        )}
      </div>

      {(report.highlights && report.highlights.length > 0) && (
        <section className="mt-auto border-t border-gray-100 pt-5" aria-label="이번 주 주요 키워드">
          <h3 className="mb-3 text-lg font-extrabold text-[var(--color-k-navy)]">주요 키워드</h3>
          <div className="flex flex-wrap gap-2">
            {report.highlights.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-bold text-gray-600"
              >
                {tag}
              </span>
            ))}
          </div>
        </section>
      )}
      <span className="mt-5 flex min-h-12 items-center justify-end text-base font-extrabold text-[var(--color-k-mascot-orange)]">자세히 보기 &gt;</span>
    </button>
  );
}
