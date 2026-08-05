import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

// POST /api/admin/plan-change-requests/[id]/reject
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
  const reason = (body.reason ?? "").trim().slice(0, 500);

  const service = createServiceClient();

  const { data: reqRow } = await service
    .from("plan_change_requests")
    .select("deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (reqRow?.deleted_at) {
    return NextResponse.json({ error: "삭제된 요청입니다." }, { status: 404 });
  }

  const { data, error } = await service.rpc("admin_reject_plan_change_request", {
    p_admin_user_id: adminUser.id,
    p_admin_email: adminUser.email!,
    p_request_id: id,
    p_reason: reason || null,
  });

  if (error) {
    console.error("[plan-change-requests/reject] RPC error:", error);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }

  const result = data?.[0] as { success: boolean; reason: string | null } | undefined;
  if (!result?.success) {
    if (result?.reason === "not_found") {
      return NextResponse.json({ error: "요청을 찾을 수 없습니다." }, { status: 404 });
    }
    if (result?.reason === "already_processed") {
      return NextResponse.json({ error: "이미 처리된 요청입니다." }, { status: 409 });
    }
    return NextResponse.json({ error: "거절 처리에 실패했습니다." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
