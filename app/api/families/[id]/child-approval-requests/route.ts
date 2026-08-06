import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { mergeCurrentChildProfiles } from "@/lib/childApproval/mergeCurrentProfile";

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
      requested_at, reviewed_at, rejected_reason, failure_reason, failed_at,
      created_child_id
    `)
    .eq("family_id", familyId)
    .order("requested_at", { ascending: false });

  if (error) {
    console.error("[api/families/:id/child-approval-requests] error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // requests/request_parent_child_profile_sync.md — 승인 완료된 아이는 신청 당시
  // 스냅샷이 아니라 child_profiles의 현재 값을 단일 기준으로 표시한다. 연결은 이름
  // 문자열 비교가 아니라 기존 FK(created_child_id → child_profiles.id, 승인 처리 시
  // 이미 채워지고 있었음)만 사용한다(§5.2, §7.1 "기존 FK가 있으면 재사용, 마이그레이션
  // 만들지 않는다").
  const mergedRequests = await mergeCurrentChildProfiles(svc, data ?? []);

  // 보호자 화면용 필터링 (053/requests_orphan_cleanup):
  // 승인 완료(approved) 또는 프로필 생성 실패(creation_failed) 상태이면서
  // created_child_id가 NULL이거나 연결된 child_profiles 행이 존재하지 않는(profileMissing === true)
  // 삭제된 아이의 유령(orphan) 승인 요청은 보호자 화면에서 완전히 제외한다.
  // (단, pending/rejected 등 승인 대기/거절 중인 정상 요청은 created_child_id가 NULL이어도 노출 유지)
  const requests = mergedRequests.filter((r) => {
    if ((r.status === "approved" || r.status === "creation_failed") && (!r.created_child_id || r.profileMissing)) {
      return false;
    }
    return true;
  });

  return NextResponse.json({ requests });
}
