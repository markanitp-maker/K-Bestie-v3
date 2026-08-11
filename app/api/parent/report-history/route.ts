import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { getEffectiveRetention, type Tier } from "@/lib/plan/retention";

export const runtime = "nodejs";

function getKstDate(daysAgo: number) {
  const now = new Date();
  const kstTime = now.getTime() + (9 * 60 * 60 * 1000);
  const targetTime = kstTime - (daysAgo * 24 * 60 * 60 * 1000);
  const targetDate = new Date(targetTime);
  return targetDate.toISOString().split("T")[0];
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const childId = req.nextUrl.searchParams.get("childId");
  const month = req.nextUrl.searchParams.get("month"); // YYYY-MM
  const recent = req.nextUrl.searchParams.get("recent"); // "true"

  if (!childId) {
    return NextResponse.json({ error: "childId required" }, { status: 400 });
  }

  const authCheck = await requireChildAccess(supabase, user.id, childId);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 1. 과거 달력용 Metadata 조회
  if (month) {
    const [yyyy, mm] = month.split("-");
    const startDate = `${yyyy}-${mm}-01`;
    const nextMonth = new Date(parseInt(yyyy), parseInt(mm), 1);
    const endDate = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`;

    const { data: rawReports, error } = await supabase
      .from("daily_reports")
      .select("id, child_id, business_date, created_at, mood_score, emotion_level")
      .eq("child_id", childId)
      .is("deleted_at", null)
      .gte("business_date", startDate)
      .lt("business_date", endDate);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const reportsMap = new Map();
    for (const r of rawReports || []) {
      const existing = reportsMap.get(r.business_date);
      if (!existing || new Date(r.created_at) > new Date(existing.created_at)) {
        reportsMap.set(r.business_date, r);
      }
    }
    const reports = Array.from(reportsMap.values()).map(r => ({
      report_id: r.id,
      child_id: r.child_id,
      report_date: r.business_date,
      created_at: r.created_at,
      mood_score: r.mood_score,
      emotion_level: r.emotion_level
    }));

    const { data: child, error: childErr } = await supabase.from("child_profiles").select("tier, family_id").eq("id", childId).single();
    if (childErr || !child) {
      return NextResponse.json({ error: "아이 정보를 찾을 수 없습니다." }, { status: 404 });
    }
    const tier = (child.tier || 1) as Tier;
    let extensionYears = 0;
    let premiumYears = 5;

    if (tier === 2) {
      const { data: extData, error: extErr } = await supabase
        .from("insight_retention_extensions")
        .select("extension_years_purchased")
        .eq("family_id", child.family_id)
        .maybeSingle();
      if (extErr) {
        return NextResponse.json({ error: "확장팩 정보를 조회하지 못했습니다." }, { status: 500 });
      }
      if (extData) {
        extensionYears = extData.extension_years_purchased;
      }
    } else if (tier === 3) {
      const { data: famData, error: famErr } = await supabase
        .from("families")
        .select("premium_retention_years")
        .eq("id", child.family_id)
        .single();
      if (famErr) {
        return NextResponse.json({ error: "가족 정보를 조회하지 못했습니다." }, { status: 500 });
      }
      premiumYears = famData.premium_retention_years;
    }

    const { months } = getEffectiveRetention(tier, extensionYears, premiumYears);
    let oldestAllowedMonth = "0001-01";
    if (months !== null) {
      const now = new Date();
      const kstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
      kstNow.setMonth(kstNow.getMonth() - months);
      oldestAllowedMonth = `${kstNow.getFullYear()}-${String(kstNow.getMonth() + 1).padStart(2, "0")}`;
    }

    return NextResponse.json({ reports, oldestAllowedMonth });
  }

  // 2. 최근 7일 목록 및 요약
  if (recent === "true") {
    const todayStr = getKstDate(0);
    const startOfRecent7Str = getKstDate(6);
    const startOfPrevious7Str = getKstDate(13);
    const endOfPrevious7Str = getKstDate(7);

    // 최근 7일 일간 리포트
    const { data: rawRecentReports, error: reportErr } = await supabase
      .from("daily_reports")
      .select("id, summary_line, mood_score, emotion_hint, business_date, created_at")
      .eq("child_id", childId)
      .is("deleted_at", null)
      .gte("business_date", startOfRecent7Str)
      .lte("business_date", todayStr);

    if (reportErr) return NextResponse.json({ error: reportErr.message }, { status: 500 });

    const recentMap = new Map();
    for (const r of rawRecentReports || []) {
      const existing = recentMap.get(r.business_date);
      if (!existing || new Date(r.created_at) > new Date(existing.created_at)) {
        recentMap.set(r.business_date, r);
      }
    }
    const recentReports = Array.from(recentMap.values()).sort((a, b) => b.business_date.localeCompare(a.business_date));

    // 최근 7일 / 이전 7일 대화 횟수 집계 (chat_sessions 기준, turn_count > 0 인 실제 대화)
    const recent7StartKst = `${startOfRecent7Str}T00:00:00+09:00`;
    const recent7EndKst = `${todayStr}T23:59:59.999+09:00`;
    const prev7StartKst = `${startOfPrevious7Str}T00:00:00+09:00`;
    const prev7EndKst = `${endOfPrevious7Str}T23:59:59.999+09:00`;

    const { data: recentSessions, error: recentErr } = await supabase
      .from("chat_sessions")
      .select("id, started_at")
      .eq("child_id", childId)
      .gt("turn_count", 0)
      .gte("started_at", recent7StartKst)
      .lte("started_at", recent7EndKst);

    const { data: prevSessions, error: prevErr } = await supabase
      .from("chat_sessions")
      .select("id")
      .eq("child_id", childId)
      .gt("turn_count", 0)
      .gte("started_at", prev7StartKst)
      .lte("started_at", prev7EndKst);

    if (recentErr || prevErr) {
      return NextResponse.json({ error: "세션 조회 실패" }, { status: 500 });
    }

    const recentSessionCount = recentSessions?.length ?? 0;
    const prevSessionCount = prevSessions?.length ?? 0;

    // 날짜별 상태점을 위해 각 날짜에 대화 세션이 있었는지 매핑
    const sessionDates = new Set<string>();
    if (recentSessions) {
      recentSessions.forEach((s) => {
        const date = new Date(s.started_at);
        const kstTime = date.getTime() + (9 * 60 * 60 * 1000);
        const kstDateStr = new Date(kstTime).toISOString().split("T")[0];
        sessionDates.add(kstDateStr);
      });
    }

    // 최근 7개 날짜 배열 생성
    const dates = [];
    for (let i = 0; i < 7; i++) {
      dates.push(getKstDate(6 - i)); // 과거에서 오늘 순서로
    }

    return NextResponse.json({
      reports: recentReports ?? [],
      summary: {
        recentCount: recentSessionCount,
        prevCount: prevSessionCount,
        dates: dates.map((d) => ({
          date: d,
          hasReport: recentReports?.some((r) => r.business_date === d) ?? false,
          hasSession: sessionDates.has(d),
        })),
      },
    });
  }

  return NextResponse.json({ error: "Invalid request" }, { status: 400 });
}
