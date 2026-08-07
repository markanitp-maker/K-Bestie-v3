import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTierForChild, isDetailAllowed } from "@/lib/plan/requireDetailAccess";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";
import {
  reportSectionValueForStorage,
  sanitizeReportSectionRecord,
} from "@/lib/reports/reportSectionAvailability";

export const runtime = "nodejs";

// "주간 상세" — Care Start에는 detail_text/detail_dashboard_cards를 서버측에서 스트리핑하고
// restricted:true를 함께 내려준다(요약 필드는 그대로, 상세 필드만 API 직접 호출로도 새어나가지 않음).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: weekly, error } = await supabase
    .from("weekly_summaries")
    .select("id, child_id, week_start, week_end, summary_text, detail_text, detail_dashboard_cards, mood_average, highlights, parent_guide, weekend_activity_recommendation, created_at")
    .eq("id", id)
    .single();

  if (error || !weekly) {
    return NextResponse.json({ error: "Weekly report not found" }, { status: 404 });
  }

  const authCheck = await requireChildAccess(supabase, user.id, weekly.child_id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tier = await getTierForChild(weekly.child_id);
  const restricted = !isDetailAllowed(tier);
  const normalizedWeekly = {
    ...weekly,
    detail_text: reportSectionValueForStorage(weekly.detail_text),
    detail_dashboard_cards: sanitizeReportSectionRecord(weekly.detail_dashboard_cards),
  };
  const safeWeekly = restricted
    ? { ...normalizedWeekly, detail_text: "", detail_dashboard_cards: {} }
    : normalizedWeekly;

  try {
    const { data: member } = await supabase.from('family_members').select('family_id').eq('user_id', user.id).maybeSingle();
    if (member?.family_id) {
      await logBehaviorEvent({
        eventName: "parent_report_view",
        actorType: "parent",
        actorId: user.id,
        familyId: member.family_id,
        childId: weekly.child_id,
        feature: "weekly_report",
        route: "/parent/report/weekly/[id]"
      });
    }
  } catch (e) {
    // 의도적 무시
  }

  return NextResponse.json({ weeklySummary: safeWeekly, restricted });
}
