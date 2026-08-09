import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { getCurrentKstDateStr, getWeekBoundsKst, getDaysSinceStart } from "@/lib/utils/weeklyDates";

export const runtime = "nodejs";

// week_start가 토요일(대표 확정 주간 정책, requests/029)이 아닌 행은 구 정책(월~일 등)의
// 잔존 데이터다. 삭제하지 않고 그대로 보존한다. "최근 카드" 목록(list)에서는 새 토~금
// 주간과 기간이 겹쳐 중복 카드로 보이므로 걸러내지만, "지난 기록 보기" 달력(calendar)에서는
// 대표님 확인대로 구 정책 리포트도 그대로 선택해 볼 수 있어야 하므로 걸러내지 않는다.
function isSaturdayWeekStart(weekStart: string): boolean {
  return new Date(`${weekStart}T00:00:00Z`).getUTCDay() === 6;
}

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

    // Add summaryState for the calendar — 구 정책(월~일) 리포트도 달력에서는 그대로 노출한다.
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
      .limit(6); // 카드 표시는 5개(아래 slice)지만 여유분 1개를 더 가져온다

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const currentKstDate = getCurrentKstDateStr();
    const { weekStart: currWeekStart, weekEnd: currWeekEnd } = getWeekBoundsKst(currentKstDate);

    // 배치는 토요일 06:00 KST에 "직전 완료 주간"만 생성하므로, 진행 중인 현재 주간
    // (currWeekStart)에 대한 weekly_summaries 행은 절대 존재하지 않는다.
    // 구 정책(월~일 등) 잔존 행은 새 토~금 주간과 기간이 겹쳐 카드가 중복 표시되므로 제외한다.
    const recentWeeklies = (weeklies ?? []).filter(w => isSaturdayWeekStart(w.week_start));

    // 현재(진행 중) 주간의 실시간 대화 집계 — 아직 리포트가 없으므로 항상 계산한다.
    const currentWeekStartKst = `${currWeekStart}T00:00:00+09:00`;
    const currentWeekEndKst = `${currWeekEnd}T23:59:59.999+09:00`;

    const { count: sessionCount, error: sessionErr } = await supabase
      .from("chat_sessions")
      .select("id", { count: "exact", head: true })
      .eq("child_id", childId)
      .gt("turn_count", 0)
      .gte("started_at", currentWeekStartKst)
      .lte("started_at", currentWeekEndKst);

    const currentAggregation = {
      week_start: currWeekStart,
      week_end: currWeekEnd,
      currentDayIndex: getDaysSinceStart(currWeekStart, currentKstDate),
      currentConversationCount: sessionCount ?? 0,
      expectedCompletionLabel: "다음 토요일 오전 6시에 완성돼요"
    };

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
