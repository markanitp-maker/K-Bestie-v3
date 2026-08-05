import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

// GET /api/admin/child-approval-requests?status=pending|approved|rejected|creation_failed
// 관리자 아이 승인 요청 목록(053). status 생략 시 전체, pending/creation_failed 우선 정렬.
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const status = req.nextUrl.searchParams.get("status");
  const service = createServiceClient();

  let query = service
    .from("child_approval_requests")
    .select(`
      id, family_id, requester_email, family_creator_email,
      family_name, given_name, gender, username, grade, interests,
      guardian_consent, status, requested_at, reviewed_at, reviewed_by,
      rejected_reason, failure_reason, failed_at,
      beta_verified, survey_verified, created_child_id,
      approval_method, approved_at, payment_id, payment_status
    `)
    // requests/066 소프트 삭제 — 삭제된 요청은 목록·통계·검색에서 제외한다.
    .is("deleted_at", null)
    .order("requested_at", { ascending: false });

  if (status && ["pending", "approved", "rejected", "creation_failed"].includes(status)) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[api/admin/child-approval-requests] error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const priority = (s: string) => (s === "pending" || s === "creation_failed" ? 0 : 1);
  const sorted = [...(data ?? [])].sort((a: any, b: any) => priority(a.status) - priority(b.status));

  return NextResponse.json(sorted);
}
