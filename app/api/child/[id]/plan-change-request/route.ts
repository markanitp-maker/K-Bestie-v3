import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

// GET /api/child/[id]/plan-change-request
// 부모 화면에서 현재 자녀의 최신 요금제 변경 요청 상태를 조회한다(§15).
export async function GET(
  _req: NextRequest,
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

  const service = createServiceClient();
  const { data, error } = await service
    .from("plan_change_requests")
    .select("id, current_plan_snapshot, requested_tier, status, requested_at, reviewed_at, review_note")
    .eq("child_id", id)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }

  return NextResponse.json({ request: data ?? null });
}

// POST /api/child/[id]/plan-change-request
// 부모가 다른 요금제를 선택 → 관리자 승인 요청 생성(§11). 현재 요금제를 즉시 바꾸지 않는다.
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

  let body: { requestedTier?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.requestedTier !== "number" || ![1, 2, 3].includes(body.requestedTier)) {
    return NextResponse.json({ error: "지원하지 않는 요금제입니다" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc("create_plan_change_request", {
    p_parent_user_id: user.id,
    p_child_id: id,
    p_requested_tier: body.requestedTier,
  });

  if (error) {
    console.error("[plan-change-request/POST] RPC error:", error);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }

  const result = data?.[0] as { success: boolean; reason: string | null; request_id: string | null } | undefined;
  if (!result?.success) {
    if (result?.reason === "pending_exists") {
      return NextResponse.json({ error: "이미 확인 중인 요금제 변경 요청이 있어요.", requestId: result.request_id }, { status: 409 });
    }
    if (result?.reason === "same_tier") {
      return NextResponse.json({ error: "이미 이용 중인 요금제입니다." }, { status: 400 });
    }
    if (result?.reason === "child_not_found") {
      return NextResponse.json({ error: "아이 정보를 찾을 수 없어요" }, { status: 404 });
    }
    return NextResponse.json({ error: "요청을 생성하지 못했어요" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, requestId: result.request_id });
}

// DELETE /api/child/[id]/plan-change-request
// 부모가 본인 자녀의 pending 요청을 취소(§13).
export async function DELETE(
  _req: NextRequest,
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

  const service = createServiceClient();
  const { data, error } = await service.rpc("cancel_plan_change_request", { p_child_id: id });

  if (error) {
    console.error("[plan-change-request/DELETE] RPC error:", error);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }

  const result = data?.[0] as { success: boolean; reason: string | null } | undefined;
  if (!result?.success) {
    return NextResponse.json({ error: "취소할 대기 중인 요청이 없어요" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
