import React from "react";
import { formatWeekRange } from "./CurrentWeekAggregationCard";

export interface WeeklyReportSummary {
  id: string;
  week_start: string;
  week_end: string;
  summary_text: string;
  mood_average: number;
  highlights: string[];
  summary_state: string;
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
  const dotColor = getStateColor(report.summary_state);

  return (
    <button
      onClick={(e) => onClick?.(e, report.id)}
      className={`block w-full text-left bg-white rounded-[20px] border border-gray-200 active:scale-[0.99] transition-transform flex flex-col justify-between ${
        isFeatured ? "p-5 mb-5 shadow-md" : "p-5 shadow-sm h-full min-h-[210px]"
      }`}
    >
      <div>
        <div className="flex justify-between items-start mb-2">
          <h2 className="text-lg font-bold text-[var(--color-k-navy)]">
            {formatWeekRange(report.week_start, report.week_end)}
          </h2>
          {isFeatured && isLastWeek && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-full text-white" style={{ background: "var(--color-k-mascot-orange)" }}>
              지난 완료 주간
            </span>
          )}
        </div>
        
        <p className="text-base font-bold mb-3" style={{ color: dotColor }}>
          ● {report.summary_state}
        </p>
        
        <p className={`text-[var(--color-k-navy)] leading-7 mb-4 whitespace-pre-line ${isFeatured ? "text-lg font-bold" : "text-base font-semibold"}`}>
          {report.summary_text || "주간 요약이 없습니다."}
        </p>
      </div>

      {(report.highlights && report.highlights.length > 0) && (
        <div className="flex gap-2 flex-wrap mt-auto pt-2">
          {report.highlights.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-600"
            >
              [{tag}]
            </span>
          ))}
        </div>
      )}
      <span className="mt-4 flex min-h-10 items-center justify-end text-sm font-bold text-[var(--color-k-navy)]">자세히 보기 &gt;</span>
    </button>
  );
}
