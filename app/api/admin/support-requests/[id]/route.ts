import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdminActor } from "@/lib/admin/adminActor";
import { isCustomerRequestCategory, isCustomerRequestStatus } from "@/lib/admin/customerRequests";
import { notificationIdsFromRpc, sendSupportNotificationPushes } from "@/lib/support/notifications";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const traceId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const auth = await requireAdminActor("admin-customer-requests", traceId);
  if (auth.denied) return auth.denied;

  const { id } = await params;
  const body = await req.json();
  const status = body.status == null ? null : body.status;
  const category = body.category == null ? null : body.category;
  const adminNote = typeof body.admin_note === "string" ? body.admin_note.trim().slice(0, 4000) : null;
  const userResponse = typeof body.user_response === "string" ? body.user_response.trim() : null;
  if (status !== null && !isCustomerRequestStatus(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  if (category !== null && !isCustomerRequestCategory(category)) return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  if (userResponse !== null && (userResponse.length < 1 || userResponse.length > 2000)) {
    return NextResponse.json({ error: "Invalid user response" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc("admin_update_support_request_v2", {
    p_request_id: id,
    p_status: status,
    p_admin_note: adminNote,
    p_user_response: userResponse,
    p_category: category,
    p_admin_user_id: auth.actor.id,
    p_admin_email: auth.actor.email,
    p_request_trace_id: traceId,
  });
  if (error) {
    const invalid = /INVALID_|NOT_FOUND/.test(error.message);
    return NextResponse.json({ error: error.message }, { status: invalid ? 409 : 500 });
  }
  const notificationIds = notificationIdsFromRpc(data);
  try {
    const pushResult = await sendSupportNotificationPushes(service, notificationIds);
    if (pushResult.failed > 0) {
      console.error("[admin-support-request] push partially failed", { requestId: id, ...pushResult });
    }
  } catch {
    console.error("[admin-support-request] push dispatch failed", { requestId: id, notificationCount: notificationIds.length });
  }
  const request = typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as { request?: unknown }).request ?? null
    : null;
  return NextResponse.json({ success: true, request, notificationCount: notificationIds.length });
}
