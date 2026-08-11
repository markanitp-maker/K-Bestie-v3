import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { checkApprovalForChild } from "@/lib/plan/approvalGuard";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const authCheck = await requireChildAccess(supabase, user.id, id);
  if (!authCheck.allowed || authCheck.role !== "parent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // codex 044 리뷰 지적: 승인 대기·거절 상태의 부모도 플랜을 직접 변경할 수 있었다 -
  // 기존 승인 가드를 재사용해 fail-closed로 차단한다.
  const approvalBlock = await checkApprovalForChild(id);
  if (approvalBlock) return approvalBlock;

  let body: { tier?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const requestedTier = body.tier;
  if (typeof requestedTier !== "number" || ![1, 2, 3].includes(requestedTier)) {
    return NextResponse.json({ error: "지원하지 않는 요금제입니다." }, { status: 400 });
  }

  // 053: Care Premium(tier=3)은 모든 환경에서 차단
  if (requestedTier === 3) {
    return NextResponse.json({ error: "Care Premium은 현재 준비 중입니다." }, { status: 403 });
  }

  const service = createServiceClient();

  // tier 변경과 retention 스탬프/복구는 DB의 단일 트랜잭션에서 처리한다.
  const { data, error } = await service.rpc("apply_plan_tier_change", {
    p_child_id: id,
    p_new_tier: requestedTier,
  });

  if (error) {
    console.error("[child/plan/POST] Apply plan tier change error:", error);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }

  const result = data as {
    success: boolean;
    old_tier: number | null;
    new_tier: number | null;
  } | null;

  if (!result?.success) {
    return NextResponse.json({ error: "아이 정보를 찾을 수 없습니다." }, { status: 404 });
  }

  if (result.old_tier === null || result.new_tier === null) {
    console.error("[child/plan/POST] Invalid RPC result:", result);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }

  const oldTier = result.old_tier;
  const newTier = result.new_tier;

  if (oldTier === newTier) {
    return NextResponse.json({ ok: true });
  }

  // 이력 기록
  await service.from("plan_change_requests").insert({
    parent_user_id: user.id,
    child_id: id,
    current_plan_snapshot: oldTier,
    requested_tier: newTier,
    status: "approved",
    reviewed_at: new Date().toISOString(),
    review_note: "Self-service instant change",
    approved_plan_applied_at: new Date().toISOString(),
  });

  // 기존 대기 중인 요청이 있다면 취소 처리
  await service
    .from("plan_change_requests")
    .update({ status: "cancelled", review_note: "Superseded by self-service change" })
    .eq("child_id", id)
    .eq("status", "pending");

  return NextResponse.json({ ok: true, tier: newTier });
}
