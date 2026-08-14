import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdminActor } from "@/lib/admin/adminActor";
import { isCustomerRequestStatus } from "@/lib/admin/customerRequests";
import { notificationIdsFromRpc, sendSupportNotificationPushes } from "@/lib/support/notifications";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const traceId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const auth = await requireAdminActor("admin-customer-requests", traceId);
  if (auth.denied) return auth.denied;
  const { ids, status } = await req.json();
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 200 || !ids.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "Invalid request ids" }, { status: 400 });
  }
  if (!isCustomerRequestStatus(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  const service = createServiceClient();
  const { data, error } = await service.rpc("admin_bulk_update_support_request_status_v2", {
    p_request_ids: Array.from(new Set(ids)),
    p_status: status,
    p_admin_user_id: auth.actor.id,
    p_admin_email: auth.actor.email,
    p_request_trace_id: traceId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: /INVALID_|NOT_FOUND/.test(error.message) ? 409 : 500 });
  const notificationIds = notificationIdsFromRpc(data);
  try {
    const pushResult = await sendSupportNotificationPushes(service, notificationIds);
    if (pushResult.failed > 0) {
      console.error("[admin-support-request-bulk] push partially failed", pushResult);
    }
  } catch {
    console.error("[admin-support-request-bulk] push dispatch failed", { notificationCount: notificationIds.length });
  }
  const updated = typeof data === "object" && data !== null && !Array.isArray(data)
    ? Number((data as { updated_count?: unknown }).updated_count ?? 0)
    : 0;
  return NextResponse.json({ success: true, updated, notificationCount: notificationIds.length });
}
