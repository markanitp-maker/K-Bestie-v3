import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTierForChild, isDetailAllowed } from "@/lib/plan/requireDetailAccess";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { meaningfulReportSectionContent } from "@/lib/reports/reportSectionAvailability";

export const runtime = "nodejs";

// 이 라우트는 "일간 상세"(dashboard_cards/parent_guide 포함)를 반환하되, Care Start
// 계정에는 서버측에서 상세 전용 필드를 스트리핑하고 restricted:true를 함께 내려준다
// (요약은 그대로 볼 수 있게 하면서, API를 직접 호출해도 상세 필드는 절대 새어나가지 않음).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // requests/017-report-check.md — daily_reports.child_id를 직접 인증/등급 판정에
  // 쓴다. 과거에는 session_id로 chat_sessions를 조인해 child_id를 얻었는데(그 값이
  // 없으면 인증 체크 자체가 통째로 스킵되는 구조였다), 신규 생성 리포트는 session_id가
  // NULL일 수 있어(child_id+business_date로 여러 세션을 합쳐 생성) 그 경로로는 인증이
  // 아예 뚫릴 위험이 있었다. 반드시 daily_reports.child_id로만 판정한다.
  const { data: report, error } = await supabase
    .from("daily_reports")
    .select(
      "id, summary_line, mood_score, emotion_tags, parent_guide, emotion_level, dashboard_cards, school_academy_life, peer_friendship, emotion_hint, interests_preferences, study_concerns, digital_content_interests, future_dreams, teacher_adults, recurring_stories, created_at, business_date, child_id"
    )
    .eq("id", id)
    .single();

  if (error || !report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  if (!report.child_id) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const authCheck = await requireChildAccess(supabase, user.id, report.child_id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tier = await getTierForChild(report.child_id);
  const restricted = !isDetailAllowed(tier);

  const { child_id: _childId, ...rest } = report;
  const normalizedRest = {
    ...rest,
    school_academy_life: meaningfulReportSectionContent(rest.school_academy_life),
    peer_friendship: meaningfulReportSectionContent(rest.peer_friendship),
    emotion_hint: meaningfulReportSectionContent(rest.emotion_hint),
    interests_preferences: meaningfulReportSectionContent(rest.interests_preferences),
    study_concerns: meaningfulReportSectionContent(rest.study_concerns),
    digital_content_interests: meaningfulReportSectionContent(rest.digital_content_interests),
    future_dreams: meaningfulReportSectionContent(rest.future_dreams),
    teacher_adults: meaningfulReportSectionContent(rest.teacher_adults),
    recurring_stories: meaningfulReportSectionContent(rest.recurring_stories),
  };
  const safeRest = restricted
    ? {
        ...normalizedRest,
        parent_guide: "",
        dashboard_cards: {},
        emotion_level: null,
        school_academy_life: null,
        peer_friendship: null,
        emotion_hint: null,
        interests_preferences: null,
        study_concerns: null,
        digital_content_interests: null,
        future_dreams: null,
        teacher_adults: null,
        recurring_stories: null
      }
    : normalizedRest;

  return NextResponse.json({ report: safeRest, restricted });
}
