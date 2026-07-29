import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { stampRetention, restoreRetention } from "@/lib/plan/retentionStamp";
import type { Tier } from "@/lib/plan/retention";

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
    .select("requested_tier")
    .eq("id", id)
    .maybeSingle();
  if (reqRow?.requested_tier === 3) {
    return NextResponse.json({ error: "Care Premium은 현재 준비 중입니다." }, { status: 403 });
  }

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
    if (result?.reason === "tier_conflict") {
      return NextResponse.json({ error: "요청 이후 현재 요금제가 변경되어 자동 승인할 수 없습니다. 현재 상태를 확인해 주세요." }, { status: 409 });
    }
    return NextResponse.json({ error: "승인 처리에 실패했습니다." }, { status: 400 });
  }

  // PATCH /api/child/[id]와 동일한 보존기간 스탬프/복구 로직 — 요금제 변경 시 데이터
  // 보존기간이 달라지므로 tier 실변경 직후 반드시 함께 처리한다.
  if (result.child_id && result.old_tier !== null && result.new_tier !== null && result.old_tier !== result.new_tier) {
    const oldTier = result.old_tier as Tier;
    const newTier = result.new_tier as Tier;
    if (newTier < oldTier) {
      await stampRetention(result.child_id, newTier, 0);
    } else if (newTier > oldTier) {
      await restoreRetention(result.child_id, newTier, 0);
    }
  }

  return NextResponse.json({ ok: true });
}
