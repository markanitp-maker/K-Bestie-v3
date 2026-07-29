import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

// POST /api/admin/child-approval-requests/[id]/reject
// 053: 계정/프로필을 만들지 않고 거절 처리. 이전 시도에서 auth 계정만 생성된 채
// creation_failed로 남아있던 경우(고아 계정) 거절 시 함께 정리한다.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const supabase = await createClient();
  const { data: { user: adminUser } } = await supabase.auth.getUser();
  if (!adminUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { reason?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;

  const svc = createServiceClient();
  const { data, error } = await svc.rpc("admin_reject_child_approval_request", {
    p_request_id: id,
    p_admin_user_id: adminUser.id,
    p_admin_email: adminUser.email!,
    p_reason: reason,
  });

  if (error) {
    console.error("[child-approval-requests/reject] RPC error:", error);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }

  const result = data?.[0] as { success: boolean; reason: string | null; orphaned_auth_user_id: string | null } | undefined;
  if (!result?.success) {
    return NextResponse.json({ error: "이미 처리된 요청입니다" }, { status: 409 });
  }

  if (result.orphaned_auth_user_id) {
    const { error: deleteError } = await svc.auth.admin.deleteUser(result.orphaned_auth_user_id);
    if (deleteError) {
      console.error("[child-approval-requests/reject] orphaned auth cleanup failed:", deleteError);
    }
  }

  return NextResponse.json({ success: true });
}
