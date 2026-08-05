import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdminActor } from "@/lib/admin/adminActor";
import {
  SOFT_DELETE_RESOURCES,
  SoftDeleteError,
  normalizeIds,
  requireSoftDeleteResource,
  restoreRecords,
} from "@/lib/admin/softDeleteService";

export const runtime = "nodejs";

/**
 * POST /api/admin/trash/restore
 * body: { resource, ids: string[] }
 *
 * 소프트 삭제된 운영 요청 데이터의 복구(개별·일괄 공통). 이미 복구된 건은
 * skipped로 분류해 멱등하게 처리한다.
 */
export async function POST(req: NextRequest) {
  const { denied, actor } = await requireAdminActor("admin_ui", req.headers.get("x-request-id"));
  if (denied) return denied;

  let body: { resource?: unknown; ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  try {
    const resource = requireSoftDeleteResource(body.resource);
    const ids = normalizeIds(body.ids);

    const result = await restoreRecords(createServiceClient(), resource, ids, actor);

    return NextResponse.json({
      ok: true,
      resource,
      resourceLabel: SOFT_DELETE_RESOURCES[resource].label,
      requested: ids.length,
      restoredCount: result.changed.length,
      skippedCount: result.unchanged.length,
      restoredIds: result.changed,
      skippedIds: result.unchanged,
      failed: result.failed,
    });
  } catch (err) {
    if (err instanceof SoftDeleteError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/admin/trash/restore] error:", err);
    return NextResponse.json({ error: "복구 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
