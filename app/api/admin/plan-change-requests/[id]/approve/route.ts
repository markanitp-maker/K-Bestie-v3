import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

// POST /api/admin/plan-change-requests/[id]/approve
// 승인 즉시 자녀 tier를 원자적으로 변경(§19). 요청 당시 스냅샷과 실제 현재 tier가 다르면
// (충돌) RPC가 거부한다 — 강제 덮어쓰기 기능은 이번 작업 범위 밖(§20).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const supabase = await createClient();
  const { data: { user: adminUser } } = await supabase.auth.getUser();
  if (!adminUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();

  // 053: Care Premium(tier=3)은 모든 환경에서 차단 - 생성 자체를 막았지만 이 마이그레이션
  // 이전에 이미 만들어진 pending 요청이 남아있을 가능성에 대비한 방어적 재검증.
  const { data: reqRow } = await service
    .from("plan_change_requests")
    .select("requested_tier, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (reqRow?.deleted_at) {
    return NextResponse.json({ error: "삭제된 요청입니다." }, { status: 404 });
  }
  if (reqRow?.requested_tier === 3) {
    return NextResponse.json({ error: "Care Premium은 현재 준비 중입니다." }, { status: 403 });
  }

  // 이 RPC가 DB 내부에서 apply_plan_tier_change를 호출하므로 요청 승인, tier 변경,
  // retention 스탬프/복구, 감사 로그가 하나의 트랜잭션으로 처리된다.
  const { data, error } = await service.rpc("admin_approve_plan_change_request", {
    p_admin_user_id: adminUser.id,
    p_admin_email: adminUser.email!,
    p_request_id: id,
  });

  if (error) {
    console.error("[plan-change-requests/approve] RPC error:", error);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }

  const result = data?.[0] as {
    success: boolean;
    reason: string | null;
    child_id: string | null;
    old_tier: number | null;
    new_tier: number | null;
  } | undefined;

  if (!result?.success) {
    if (result?.reason === "not_found") {
      return NextResponse.json({ error: "요청을 찾을 수 없습니다." }, { status: 404 });
    }
    if (result?.reason === "already_processed") {
      return NextResponse.json({ error: "이미 처리된 요청입니다." }, { status: 409 });
    }
    if (result?.reason === "deleted") {
      return NextResponse.json({ error: "삭제된 요청입니다." }, { status: 404 });
    }
    if (result?.reason === "premium_blocked") {
      return NextResponse.json({ error: "Care Premium은 현재 준비 중입니다." }, { status: 403 });
    }
    if (result?.reason === "tier_conflict") {
      return NextResponse.json({ error: "요청 이후 현재 요금제가 변경되어 자동 승인할 수 없습니다. 현재 상태를 확인해 주세요." }, { status: 409 });
    }
    return NextResponse.json({ error: "승인 처리에 실패했습니다." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
