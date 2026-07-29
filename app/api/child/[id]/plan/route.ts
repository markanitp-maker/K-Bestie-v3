import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { stampRetention, restoreRetention } from "@/lib/plan/retentionStamp";
import type { Tier } from "@/lib/plan/retention";
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

  // 현재 요금제 조회
  const { data: childProfile, error: profileErr } = await service
    .from("child_profiles")
    .select("tier")
    .eq("id", id)
    .maybeSingle();

  if (profileErr || !childProfile) {
    return NextResponse.json({ error: "아이 정보를 찾을 수 없습니다." }, { status: 404 });
  }

  const oldTier = childProfile.tier as Tier;
  const newTier = requestedTier as Tier;

  if (oldTier === newTier) {
    return NextResponse.json({ ok: true });
  }

  // 업데이트
  const { error: updateErr } = await service
    .from("child_profiles")
    .update({ tier: newTier })
    .eq("id", id);

  if (updateErr) {
    console.error("[child/plan/POST] Update tier error:", updateErr);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }

  // 보존 정책 갱신
  if (newTier < oldTier) {
    await stampRetention(id, newTier, 0);
  } else if (newTier > oldTier) {
    await restoreRetention(id, newTier, 0);
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
