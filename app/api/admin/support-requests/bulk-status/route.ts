import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdminActor } from "@/lib/admin/adminActor";
import { isCustomerRequestStatus } from "@/lib/admin/customerRequests";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const traceId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const auth = await requireAdminActor("admin-customer-requests", traceId);
  if (auth.denied) return auth.denied;
  const { ids, status } = await req.json();
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 200 || !ids.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "Invalid request ids" }, { status: 400 });
  }
  if (!isCustomerRequestStatus(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  const { data, error } = await createServiceClient().rpc("admin_bulk_update_support_request_status_v1", {
    p_request_ids: Array.from(new Set(ids)),
    p_status: status,
    p_admin_user_id: auth.actor.id,
    p_admin_email: auth.actor.email,
    p_request_trace_id: traceId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: /INVALID_|NOT_FOUND/.test(error.message) ? 409 : 500 });
  return NextResponse.json({ success: true, updated: data });
}
