import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

// GET /api/admin/plan-change-requests?status=pending|approved|rejected|cancelled
// 관리자 요금제 변경 요청 목록(§17). status 생략 시 전체, pending 우선 정렬.
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const status = req.nextUrl.searchParams.get("status");
  const service = createServiceClient();

  let query = service
    .from("plan_change_requests")
    .select(`
      id,
      current_plan_snapshot,
      requested_tier,
      status,
      requested_at,
      reviewed_at,
      reviewed_by,
      review_note,
      approved_plan_applied_at,
      parents:parent_user_id ( id, name, email ),
      child_profiles:child_id ( id, name )
    `)
    // requests/066 소프트 삭제 — 삭제된 요청은 목록·통계·검색에서 제외한다.
    .is("deleted_at", null)
    .order("requested_at", { ascending: false });

  if (status && ["pending", "approved", "rejected", "cancelled"].includes(status)) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[api/admin/plan-change-requests] error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // pending 우선, 그 다음 최신순(요청일시는 이미 desc로 받아왔으므로 status 그룹만 재정렬)
  const sorted = [...(data ?? [])].sort((a: any, b: any) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (a.status !== "pending" && b.status === "pending") return 1;
    return 0;
  });

  return NextResponse.json(sorted);
}
