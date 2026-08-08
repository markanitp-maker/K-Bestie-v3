import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdminActor } from "@/lib/admin/adminActor";

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
  const requestId = req.headers.get("x-request-id")?.slice(0, 128) || crypto.randomUUID();
  const { denied, actor } = await requireAdminActor("admin_events_rewards", requestId);
  if (denied) return denied;

  const { id } = await params;

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
    .select("status,child_id,admin_note")
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
    update.approved_by = actor.id;
    update.approved_at = now;
  }
  if (nextStatus === "delivered") {
    update.delivered_at = now;
    update.delivered_by = actor.id;
    // delivery_method는 마이그레이션에서 'offline' 고정 체크 제약 — 여기서 다시 명시해 의도를 분명히 한다.
    update.delivery_method = "offline";
  }

  const { data: audit, error: auditError } = await service.from("admin_audit_log").insert({
    admin_user_id: actor.id,
    admin_email: actor.email,
    action: "EVENT_REWARD_STATUS_TRANSITION",
    child_id: current.child_id,
    resource_type: "event_reward_fulfillments",
    resource_id: id,
    before_snapshot: { status: current.status, admin_note: current.admin_note },
    after_snapshot: { requested_status: nextStatus, admin_note: body.adminNote ?? current.admin_note, result: "pending" },
    request_id: requestId,
    source: actor.source,
  }).select("id").single();
  if (auditError || !audit) {
    console.error("[admin/events/reward-fulfillments] audit insert failed", auditError?.code ?? "missing");
    return NextResponse.json({ error: "감사 로그를 기록하지 못해 상태 변경을 중단했습니다." }, { status: 500 });
  }

  const { data: updated, error: updateErr } = await service
    .from("event_reward_fulfillments")
    .update(update)
    .eq("id", id)
    .eq("status", current.status) // compare-and-set — 동시 처리 경합 방지
    .select()
    .maybeSingle();

  if (updateErr || !updated) {
    await service.from("admin_audit_log").update({
      after_snapshot: { requested_status: nextStatus, admin_note: body.adminNote ?? current.admin_note, result: "failed_or_concurrent" },
    }).eq("id", audit.id);
    return NextResponse.json({ error: "Update failed or state changed concurrently" }, { status: 409 });
  }

  const { error: auditFinalizeError } = await service.from("admin_audit_log").update({
    after_snapshot: { status: updated.status, admin_note: updated.admin_note, result: "success" },
  }).eq("id", audit.id);
  if (auditFinalizeError) {
    console.error("[admin/events/reward-fulfillments] audit finalize failed", auditFinalizeError.code);
  }

  return NextResponse.json({ ...updated, requestId });
}
