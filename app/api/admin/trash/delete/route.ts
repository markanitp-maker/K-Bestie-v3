import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdminActor } from "@/lib/admin/adminActor";
import {
  SOFT_DELETE_RESOURCES,
  SoftDeleteError,
  normalizeDeleteReason,
  normalizeIds,
  requireSoftDeleteResource,
  softDeleteRecords,
} from "@/lib/admin/softDeleteService";

export const runtime = "nodejs";

/**
 * POST /api/admin/trash/delete
 * body: { resource, ids: string[], reason: string }
 *
 * 관리자 운영 요청 데이터의 소프트 삭제(개별·일괄 공통 엔드포인트).
 * resource는 softDeleteService의 화이트리스트에만 매칭되며, 테이블명을 요청 값으로
 * 조립하지 않는다. 제외 대상(부모·아이·가족·대화·미션·리포트·원장 등)은 화이트리스트에
 * 아예 존재하지 않으므로 이 API로 접근할 수 없다.
 */
export async function POST(req: NextRequest) {
  const { denied, actor } = await requireAdminActor("admin_ui", req.headers.get("x-request-id"));
  if (denied) return denied;

  let body: { resource?: unknown; ids?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  try {
    const resource = requireSoftDeleteResource(body.resource);
    const ids = normalizeIds(body.ids);
    const reason = normalizeDeleteReason(body.reason);

    const result = await softDeleteRecords(createServiceClient(), resource, ids, actor, reason);

    return NextResponse.json({
      ok: true,
      resource,
      resourceLabel: SOFT_DELETE_RESOURCES[resource].label,
      requested: ids.length,
      deletedCount: result.changed.length,
      skippedCount: result.unchanged.length,
      deletedIds: result.changed,
      skippedIds: result.unchanged,
      failed: result.failed,
    });
  } catch (err) {
    if (err instanceof SoftDeleteError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/admin/trash/delete] error:", err);
    return NextResponse.json({ error: "삭제 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
