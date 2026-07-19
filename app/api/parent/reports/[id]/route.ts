import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTierForChild, isDetailAllowed } from "@/lib/plan/requireDetailAccess";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";

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

  // 리포트+세션을 한 번의 쿼리로 조회 — 예전엔 두 번 순차 조회(리포트 → 세션)해서
  // 왕복이 하나 더 걸렸음(상세 화면 진입 시 스켈레톤이 길게 보이던 원인 중 하나).
  const { data: report, error } = await supabase
    .from("daily_reports")
    .select(
      "id, summary_line, mood_score, emotion_tags, parent_guide, emotion_level, dashboard_cards, school_academy_life, peer_friendship, emotion_hint, interests_preferences, study_concerns, digital_content_interests, future_dreams, recurring_stories, created_at, session_id, chat_sessions(started_at, turn_count, ended_at, child_id)"
    )
    .eq("id", id)
    .single();

  if (error || !report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const { chat_sessions, ...rest } = report as typeof report & {
    chat_sessions: { started_at: string; turn_count: number; ended_at: string | null; child_id: string } | null;
  };

  if (chat_sessions?.child_id) {
    const authCheck = await requireChildAccess(supabase, user.id, chat_sessions.child_id);
    if (!authCheck.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  let restricted = false;
  if (chat_sessions?.child_id) {
    const tier = await getTierForChild(chat_sessions.child_id);
    restricted = !isDetailAllowed(tier);
  }

  const { child_id: _childId, ...sessionRest } = chat_sessions ?? { child_id: undefined };
  const safeRest = restricted
    ? { 
        ...rest, 
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
        recurring_stories: null
      }
    : rest;

  return NextResponse.json({ report: { ...safeRest, session: chat_sessions ? sessionRest : null }, restricted });
}
