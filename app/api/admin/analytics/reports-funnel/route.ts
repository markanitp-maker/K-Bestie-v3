import { NextRequest, NextResponse } from "next/server";
import { resolveAnalyticsKstFilters } from "@/lib/admin/analyticsKst";
import {
  fetchAllAnalyticsRows,
  loadAnalyticsIdentity,
  roundAverage,
  roundRate,
  settledValue,
} from "@/lib/admin/analyticsPhase2";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface DailyReportRow { id: string; child_id: string | null; business_date: string | null; created_at: string }
interface ReportViewRow { report_id: string; viewed_at: string }
interface WeeklyReportRow { id: string; child_id: string; week_start: string; created_at: string }
interface WeeklyViewRow { child_id: string | null; occurred_at: string; feature: string; event_name: string }

function funnel(generatedAtById: Map<string, string>, viewedAtById: Map<string, string>) {
  const durations: number[] = [];
  let viewed = 0;
  for (const [id, generatedAt] of generatedAtById) {
    const viewedAt = viewedAtById.get(id);
    if (!viewedAt) continue;
    viewed += 1;
    const duration = (Date.parse(viewedAt) - Date.parse(generatedAt)) / 1000;
    if (duration >= 0) durations.push(duration);
  }
  return {
    generated: generatedAtById.size,
    viewed,
    unviewed: Math.max(0, generatedAtById.size - viewed),
    viewRate: roundRate(viewed, generatedAtById.size),
    averageSecondsToFirstView: roundAverage(durations),
  };
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  let filters;
  try {
    filters = resolveAnalyticsKstFilters(req.nextUrl.searchParams);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "잘못된 조회 기간입니다." }, { status: 400 });
  }
  const service = createServiceClient();
  try {
    const settled = await Promise.allSettled([
      loadAnalyticsIdentity(service, filters.internalTest, filters.channel),
      fetchAllAnalyticsRows<DailyReportRow>(() => service.from("daily_reports")
        .select("id,child_id,business_date,created_at")
        .gte("business_date", filters.from).lte("business_date", filters.to)
        .is("deleted_at", null), { column: "created_at", uniqueColumn: "id" }),
      fetchAllAnalyticsRows<ReportViewRow>(() => service.from("report_views")
        .select("report_id,viewed_at").lt("viewed_at", filters.toExclusiveIso), { column: "viewed_at", uniqueColumn: "id" }),
      fetchAllAnalyticsRows<WeeklyReportRow>(() => service.from("weekly_summaries")
        .select("id,child_id,week_start,created_at")
        .gte("week_start", filters.from).lte("week_start", filters.to)
        .is("deleted_at", null), { column: "created_at", uniqueColumn: "id" }),
      fetchAllAnalyticsRows<WeeklyViewRow>(() => service.from("behavior_events")
        .select("child_id,occurred_at,feature,event_name")
        .eq("event_name", "parent_report_view").eq("feature", "weekly_report")
        .lt("occurred_at", filters.toExclusiveIso), { column: "occurred_at", uniqueColumn: "id" }),
    ]);
    const identity = settledValue(settled[0], "분석 대상");
    const dailyReports = settledValue(settled[1], "일일 리포트").filter((row) => row.child_id && identity.childIds.has(row.child_id));
    const dailyIds = new Set(dailyReports.map((row) => row.id));
    const dailyGenerated = new Map(dailyReports.map((row) => [row.id, row.created_at]));
    const dailyViewed = new Map<string, string>();
    for (const view of settledValue(settled[2], "일일 리포트 열람")) {
      if (!dailyIds.has(view.report_id)) continue;
      const previous = dailyViewed.get(view.report_id);
      if (!previous || view.viewed_at < previous) dailyViewed.set(view.report_id, view.viewed_at);
    }

    const weeklyReports = settledValue(settled[3], "주간 리포트").filter((row) => identity.childIds.has(row.child_id));
    const weeklyEventsByChild = new Map<string, string[]>();
    for (const event of settledValue(settled[4], "주간 리포트 열람")) {
      if (!event.child_id || !identity.childIds.has(event.child_id)) continue;
      const values = weeklyEventsByChild.get(event.child_id) ?? [];
      values.push(event.occurred_at);
      weeklyEventsByChild.set(event.child_id, values);
    }
    const weeklyGenerated = new Map(weeklyReports.map((row) => [row.id, row.created_at]));
    const weeklyViewed = new Map<string, string>();
    const weeklyByChild = new Map<string, WeeklyReportRow[]>();
    for (const report of weeklyReports) {
      const childReports = weeklyByChild.get(report.child_id) ?? [];
      childReports.push(report);
      weeklyByChild.set(report.child_id, childReports);
    }
    for (const [childId, childReports] of weeklyByChild) {
      const ordered = childReports.sort((left, right) => left.created_at.localeCompare(right.created_at));
      const childViews = (weeklyEventsByChild.get(childId) ?? []).sort();
      ordered.forEach((report, index) => {
        const nextCreatedAt = ordered[index + 1]?.created_at;
        const firstView = childViews.find((value) => value >= report.created_at && (!nextCreatedAt || value < nextCreatedAt));
        if (firstView) weeklyViewed.set(report.id, firstView);
      });
    }

    return NextResponse.json({
      filters,
      daily: funnel(dailyGenerated, dailyViewed),
      weekly: funnel(weeklyGenerated, weeklyViewed),
      meta: {
        dailyViewSource: "report_views",
        weeklyViewSource: "behavior_events(feature=weekly_report)",
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[admin/analytics/reports-funnel] 집계 실패:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "리포트 Funnel 집계에 실패했습니다." }, { status: 500 });
  }
}
