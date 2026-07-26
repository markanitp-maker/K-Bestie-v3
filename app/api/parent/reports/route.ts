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

  // requests/017-report-check.md — daily_reports는 이제 child_id+business_date로
  // 그날의 미션+자유대화를 전부 합쳐 1건 생성되므로(session_id 경유 조회 대신) child_id로
  // 직접 조회한다(하루 여러 세션이 있어도 리포트는 1건, session_id는 더 이상 신뢰
  // 가능한 앵커가 아니라 신규 생성분은 NULL일 수 있음).
  const { data: reports, error } = await supabase
    .from("daily_reports")
    .select("id, summary_line, mood_score, emotion_tags, parent_guide, emotion_level, dashboard_cards, school_academy_life, peer_friendship, emotion_hint, interests_preferences, study_concerns, digital_content_interests, future_dreams, recurring_stories, viewed_at, created_at, business_date")
    .eq("child_id", childId)
    .is("deleted_at", null)
    .order("business_date", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ reports: reports ?? [], childName: child?.name ?? null });
}
