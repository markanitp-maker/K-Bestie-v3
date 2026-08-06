import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

// requests/request-parent-question-feature.md §14 — 관리자 조회 전용(읽기 전용).
// 원문 대화 전체가 아니라 운영에 필요한 최소 정보만 노출한다: 질문/상태/일정·재시도
// 정보와, 식별을 위한 아이 이름·가족명 정도만 조인한다(아이의 실제 답변 원문은
// 이미 child_answer_summary 단계에서 3인칭 순화를 거친 값만 저장되므로 그대로 노출해도
// 대화 원문 노출 금지 원칙에 저촉되지 않는다).
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const url = req.nextUrl;
  const status = url.searchParams.get("status");

  const service = createServiceClient();
  let query = service
    .from("parent_questions")
    .select(
      "id, child_id, question_text, status, created_at, deadline_at, delivered_count, mission_confirm_attempts, retry_count, confirmed_at, declined_at, cancelled_at, expired_at, child_answer_summary, failure_code, child_profiles(name, family_id)"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    console.error("[admin/parent-questions] query failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ questions: data ?? [] });
}
