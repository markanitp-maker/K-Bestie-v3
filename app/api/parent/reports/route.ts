import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import {
  buildDashboardCardInsights,
  type DashboardCardReportRow,
} from "@/lib/reports/dashboardCardInsights";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const childId = req.nextUrl.searchParams.get("childId");
  if (!childId) {
    return NextResponse.json({ error: "childId required" }, { status: 400 });
  }

  const authCheck = await requireChildAccess(supabase, user.id, childId);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { data: child } = await supabase.from("child_profiles").select("name").eq("id", childId).single();

  const { data: reports, error } = await supabase
    .from("daily_reports")
    .select("id, summary_line, mood_score, emotion_tags, parent_guide, emotion_level, dashboard_cards, school_academy_life, peer_friendship, emotion_hint, interests_preferences, study_concerns, digital_content_interests, future_dreams, teacher_adults, recurring_stories, viewed_at, created_at, business_date")
    .eq("child_id", childId)
    .is("deleted_at", null)
    .order("business_date", { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: weeklySummaries } = await supabase
    .from("weekly_summaries")
    .select("parent_guide")
    .eq("child_id", childId)
    .order("week_start", { ascending: false })
    .limit(1);

  const latestWeekly = weeklySummaries?.[0];
  const latestReport = reports?.[0] ?? null;

  // 영역별 Last Known Valid는 최신 일일 리포트 한 건이 아니라 전체 dashboard_cards
  // 이력을 기준으로 계산한다. Supabase 행 제한을 넘는 장기 계정도 누락되지 않도록
  // 페이지를 끝까지 읽고, 빈 문자열은 새 관찰로 취급하지 않는다.
  const dashboardRows: DashboardCardReportRow[] = [];
  const pageSize = 100;
  for (let from = 0; ; from += pageSize) {
    const { data: page, error: dashboardError } = await supabase
      .from("daily_reports")
      .select("dashboard_cards, business_date, emotion_level")
      .eq("child_id", childId)
      .is("deleted_at", null)
      .order("business_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (dashboardError) {
      return NextResponse.json({ error: dashboardError.message }, { status: 500 });
    }

    dashboardRows.push(...((page ?? []) as DashboardCardReportRow[]));
    if (!page || page.length < pageSize) break;
  }

  const insights = buildDashboardCardInsights(dashboardRows);

  let todaysQuote = null;
  if (latestReport?.summary_line && latestReport.summary_line.trim() !== "") {
    todaysQuote = latestReport.summary_line;
  } else if (latestReport?.parent_guide && latestReport.parent_guide.trim() !== "") {
    todaysQuote = latestReport.parent_guide;
  } else if (latestWeekly?.parent_guide && latestWeekly.parent_guide.trim() !== "") {
    todaysQuote = latestWeekly.parent_guide;
  }

  return NextResponse.json({ 
    reports: reports ?? [], 
    childName: child?.name ?? null,
    childId: childId,
    insights,
    todaysQuote
  });
}
