import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { getCurrentKstDateStr, getWeekBoundsKst, getDaysSinceStart } from "@/lib/utils/weeklyDates";

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

  const type = req.nextUrl.searchParams.get("type") || "list";

  if (type === "calendar") {
    const yearStr = req.nextUrl.searchParams.get("year");
    const monthStr = req.nextUrl.searchParams.get("month");
    if (!yearStr || !monthStr) {
      return NextResponse.json({ error: "year and month required for calendar" }, { status: 400 });
    }
    
    // Calculate start and end date of the month
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    
    // To get all weeks where week_end is in this month
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextMonthYear = month === 12 ? year + 1 : year;
    const monthEnd = `${nextMonthYear}-${String(nextMonth).padStart(2, '0')}-01`;

    const { data: weeklies, error } = await supabase
      .from("weekly_summaries")
      .select("id, child_id, week_start, week_end, summary_text, mood_average, created_at")
      .eq("child_id", childId)
      .gte("week_end", monthStart)
      .lt("week_end", monthEnd)
      .order("week_start", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Add summaryState for the calendar
    const mapped = (weeklies ?? []).map(w => {
      let summary_state = "평소와 비슷했어요";
      if (w.mood_average != null) {
        if (w.mood_average >= 8) summary_state = "편안한 한 주였어요";
        else if (w.mood_average < 6) summary_state = "살펴볼 점이 있어요";
      } else if (!w.summary_text) {
        summary_state = "데이터가 아직 적어요";
      }

      return {
        ...w,
        status: "completed",
        summary_state,
      };
    });

    return NextResponse.json({ weeklySummaries: mapped });
  } else {
    // List mode
    const { data: weeklies, error } = await supabase
      .from("weekly_summaries")
      .select("id, week_start, week_end, summary_text, mood_average, highlights, parent_guide, weekend_activity_recommendation, created_at")
      .eq("child_id", childId)
      .order("week_start", { ascending: false })
      .limit(6); // get up to 6 just in case the current week is already generated (it shouldn't be until Sat)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const currentKstDate = getCurrentKstDateStr();
    const { weekStart: currWeekStart, weekEnd: currWeekEnd } = getWeekBoundsKst(currentKstDate);

    // Is the current week already completed?
    let currentCompleted = false;
    let recentWeeklies = weeklies ?? [];
    if (recentWeeklies.length > 0 && recentWeeklies[0].week_start === currWeekStart) {
      currentCompleted = true;
      // We still include it in weeklySummaries.
    }

    let currentAggregation = null;
    if (!currentCompleted) {
      // Fetch current week conversation count (sessions with turn_count > 0)
      const currentWeekStartKst = `${currWeekStart}T00:00:00+09:00`;
      const currentWeekEndKst = `${currWeekEnd}T23:59:59.999+09:00`;

      const { count: sessionCount, error: sessionErr } = await supabase
        .from("chat_sessions")
        .select("id", { count: "exact", head: true })
        .eq("child_id", childId)
        .gt("turn_count", 0)
        .gte("started_at", currentWeekStartKst)
        .lte("started_at", currentWeekEndKst);
      
      currentAggregation = {
        week_start: currWeekStart,
        week_end: currWeekEnd,
        currentDayIndex: getDaysSinceStart(currWeekStart, currentKstDate),
        currentConversationCount: sessionCount ?? 0,
        expectedCompletionLabel: "금요일 밤에 완성돼요"
      };
    }

    // Add summaryState for cards
    const mapped = recentWeeklies.slice(0, 5).map(w => {
      let summary_state = "평소와 비슷했어요";
      if (w.mood_average != null) {
        if (w.mood_average >= 8) summary_state = "편안한 한 주였어요";
        else if (w.mood_average < 6) summary_state = "살펴볼 점이 있어요";
      } else if (!w.summary_text) {
        summary_state = "데이터가 아직 적어요";
      }
      return {
        ...w,
        summary_state
      };
    });

    return NextResponse.json({ 
      currentAggregation,
      weeklySummaries: mapped 
    });
  }
}
