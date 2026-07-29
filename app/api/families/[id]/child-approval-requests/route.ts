import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/families/[id]/child-approval-requests — 우리 가족의 아이 승인 요청 목록.
// 관리자 화면(app/api/admin/child-approval-requests)과 동일한 child_approval_requests
// 테이블의 동일한 행을 조회한다 - 부모/관리자 화면이 항상 일치한다(053).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: familyId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = createServiceClient();

  const { data: member } = await svc
    .from("family_members")
    .select("role")
    .eq("family_id", familyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member || !["owner_parent", "parent"].includes(member.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await svc
    .from("child_approval_requests")
    .select(`
      id, family_name, given_name, gender, grade, interests, status,
      requested_at, reviewed_at, rejected_reason, failure_reason, failed_at
    `)
    .eq("family_id", familyId)
    .order("requested_at", { ascending: false });

  if (error) {
    console.error("[api/families/:id/child-approval-requests] error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  return NextResponse.json({ requests: data ?? [] });
}
