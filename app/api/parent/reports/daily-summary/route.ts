import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

// "일간 요약" — daily_reports.summary_line만 투영(read-time LLM 재호출 아님, 단순 필드 프로젝션).
// 모든 요금제(Care Start 포함)에 공통 제공되므로 상세 필드(dashboard_cards/parent_guide 등)는
// 절대 포함하지 않는다(필드 화이트리스트).
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

  // requests/017-report-check.md — child_id로 직접 조회(세션 경유 join 제거, 이유는
  // app/api/parent/reports/[id]/route.ts와 동일: session_id는 신규 생성분에서 NULL일 수 있음).
  // 필드 화이트리스트 — summary_line/mood_score/created_at만(상세 필드 제외).
  const { data: reports, error } = await supabase
    .from("daily_reports")
    .select("id, summary_line, mood_score, created_at, business_date")
    .eq("child_id", childId)
    .is("deleted_at", null)
    .order("business_date", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ summaries: reports ?? [] });
}
