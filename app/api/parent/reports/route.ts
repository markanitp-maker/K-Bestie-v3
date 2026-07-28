import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";

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
    .select("id, summary_line, mood_score, emotion_tags, parent_guide, emotion_level, dashboard_cards, school_academy_life, peer_friendship, emotion_hint, interests_preferences, study_concerns, digital_content_interests, future_dreams, recurring_stories, viewed_at, created_at, business_date")
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

  const INSIGHT_FIELDS = [
    "school_academy_life",
    "peer_friendship",
    "emotion_hint",
    "interests_preferences",
    "study_concerns",
    "digital_content_interests",
    "future_dreams",
    "recurring_stories",
  ] as const;

  const insights: Record<string, any> = {};
  const now = new Date();
  const sevenDaysAgoMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;

  for (const field of INSIGHT_FIELDS) {
    let recentValue = null;
    let lastObserved = null;
    let count7d = 0;
    let emotionLevel = null;

    for (const r of (reports || [])) {
      if (r[field] && String(r[field]).trim() !== "") {
        if (!recentValue) {
          recentValue = r[field];
          lastObserved = r.business_date || r.created_at;
          if (field === "emotion_hint") {
            emotionLevel = r.emotion_level;
          }
        }
        
        const rDateMs = new Date(r.business_date || r.created_at).getTime();
        if (rDateMs >= sevenDaysAgoMs) {
          count7d++;
        }
      }
    }

    insights[field] = {
      value: recentValue,
      last_observed_at: lastObserved,
      recent_count: count7d,
      ...(field === "emotion_hint" && { emotion_level: emotionLevel }),
    };
  }

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
