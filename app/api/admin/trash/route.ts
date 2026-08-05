import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdminActor } from "@/lib/admin/adminActor";
import {
  SOFT_DELETE_RESOURCES,
  SOFT_DELETE_RESOURCE_IDS,
  SOFT_DELETE_RETENTION_DAYS,
  isSoftDeleteResource,
  listTrash,
  type SoftDeleteResource,
} from "@/lib/admin/softDeleteService";

export const runtime = "nodejs";

// GET /api/admin/trash?resource=&deletedFrom=&deletedTo=&deletedBy=&reason=
// 소프트 삭제된 관리자 운영 요청 데이터 통합 조회(휴지통).
export async function GET(req: NextRequest) {
  const { denied, actor } = await requireAdminActor("admin_ui");
  if (denied) return denied;

  const params = req.nextUrl.searchParams;
  const requestedResources = params
    .getAll("resource")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  // 화이트리스트 밖 값은 조용히 버린다(존재하지 않는 테이블을 조회 시도조차 하지 않는다).
  const resources = requestedResources.filter(isSoftDeleteResource) as SoftDeleteResource[];
  if (requestedResources.length > 0 && resources.length === 0) {
    return NextResponse.json({ error: "허용되지 않은 리소스입니다." }, { status: 400 });
  }

  try {
    const items = await listTrash(createServiceClient(), {
      resources,
      deletedFrom: params.get("deletedFrom"),
      deletedTo: params.get("deletedTo"),
      deletedBy: params.get("deletedBy"),
      reasonSearch: params.get("reason"),
      limit: Number(params.get("limit")) || undefined,
    });

    const countsByResource = SOFT_DELETE_RESOURCE_IDS.map((resource) => ({
      resource,
      label: SOFT_DELETE_RESOURCES[resource].label,
      count: items.filter((item) => item.resource === resource).length,
    }));

    return NextResponse.json({
      items,
      total: items.length,
      countsByResource,
      retentionDays: SOFT_DELETE_RETENTION_DAYS,
      viewer: actor.email,
    });
  } catch (err) {
    console.error("[api/admin/trash] list error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
