import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ["approved", "on_hold", "cancelled"],
  approved: ["scheduled", "on_hold", "cancelled"],
  scheduled: ["delivered", "on_hold"],
  on_hold: ["pending", "approved", "scheduled", "cancelled"],
  delivered: [],
  cancelled: [],
};

// PATCH /api/admin/events/reward-fulfillments/[id] — 완전 수동 워크플로우 상태 전이.
// 자동 발송 연동 없음(대표 지시) — 관리자가 오프라인 전달 후 "전달 완료"로 직접 기록한다.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const supabase = await createClient();
  const { data: { user: adminUser } } = await supabase.auth.getUser();
  if (!adminUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { status?: string; adminNote?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const nextStatus = body.status;
  if (!nextStatus) {
    return NextResponse.json({ error: "status required" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: current, error: fetchErr } = await service
    .from("event_reward_fulfillments")
    .select("status")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (fetchErr || !current) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const allowed = VALID_TRANSITIONS[current.status] ?? [];
  if (!allowed.includes(nextStatus)) {
    return NextResponse.json(
      { error: `Invalid transition ${current.status} -> ${nextStatus}` },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const update: Record<string, unknown> = { status: nextStatus, updated_at: now };
  if (body.adminNote !== undefined) update.admin_note = body.adminNote;

  if (nextStatus === "approved") {
    update.approved_by = adminUser.id;
    update.approved_at = now;
  }
  if (nextStatus === "delivered") {
    update.delivered_at = now;
    update.delivered_by = adminUser.id;
    // delivery_method는 마이그레이션에서 'offline' 고정 체크 제약 — 여기서 다시 명시해 의도를 분명히 한다.
    update.delivery_method = "offline";
  }

  const { data: updated, error: updateErr } = await service
    .from("event_reward_fulfillments")
    .update(update)
    .eq("id", id)
    .eq("status", current.status) // compare-and-set — 동시 처리 경합 방지
    .select()
    .maybeSingle();

  if (updateErr || !updated) {
    return NextResponse.json({ error: "Update failed or state changed concurrently" }, { status: 409 });
  }

  return NextResponse.json(updated);
}
