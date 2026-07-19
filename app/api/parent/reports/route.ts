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
  const [{ data: child }, { data: sessions }] = await Promise.all([
    supabase.from("child_profiles").select("name").eq("id", childId).single(),
    supabase
      .from("chat_sessions")
      .select("id, started_at, turn_count, ended_at")
      .eq("child_id", childId),
  ]);

  const sessionIds = (sessions ?? []).map((s) => s.id);
  const sessionMap = Object.fromEntries((sessions ?? []).map((s) => [s.id, s]));

  if (sessionIds.length === 0) {
    return NextResponse.json({ reports: [], childName: child?.name ?? null });
  }

  const { data: reports, error } = await supabase
    .from("daily_reports")
    .select("id, summary_line, mood_score, emotion_tags, parent_guide, emotion_level, dashboard_cards, school_academy_life, peer_friendship, emotion_hint, interests_preferences, study_concerns, digital_content_interests, future_dreams, recurring_stories, viewed_at, created_at, session_id")
    .in("session_id", sessionIds)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const enriched = (reports ?? []).map((r) => ({
    ...r,
    session: sessionMap[r.session_id] ?? null,
  }));

  return NextResponse.json({ reports: enriched, childName: child?.name ?? null });
}
