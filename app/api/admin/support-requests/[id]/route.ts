import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

// 소프트 삭제/복구는 이 라우트가 아니라 공통 엔드포인트를 쓴다:
//   POST /api/admin/trash/delete   { resource: "support_requests", ids, reason }
//   POST /api/admin/trash/restore  { resource: "support_requests", ids }
// (requests/066 — 허용 목록 밖 테이블을 건드릴 수 없도록 삭제 경로를 한 곳으로 모았다.)

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const { status, admin_note } = await req.json();

  const service = createServiceClient();
  const { error } = await service
    .from("support_requests")
    .update({ status, admin_note })
    .eq("id", id)
    // 삭제된 건은 목록에 없으므로 상태 변경 대상도 아니다.
    .is("deleted_at", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
