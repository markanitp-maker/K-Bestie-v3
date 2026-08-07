import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdminActor } from "@/lib/admin/adminActor";
import { isCustomerRequestCategory, isCustomerRequestStatus } from "@/lib/admin/customerRequests";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const traceId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const auth = await requireAdminActor("admin-customer-requests", traceId);
  if (auth.denied) return auth.denied;

  const { id } = await params;
  const body = await req.json();
  const status = body.status == null ? null : body.status;
  const category = body.category == null ? null : body.category;
  const adminNote = typeof body.admin_note === "string" ? body.admin_note.trim().slice(0, 4000) : null;
  if (status !== null && !isCustomerRequestStatus(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  if (category !== null && !isCustomerRequestCategory(category)) return NextResponse.json({ error: "Invalid category" }, { status: 400 });

  const service = createServiceClient();
  const { data, error } = await service.rpc("admin_update_support_request_v1", {
    p_request_id: id,
    p_status: status,
    p_admin_note: adminNote,
    p_category: category,
    p_admin_user_id: auth.actor.id,
    p_admin_email: auth.actor.email,
    p_request_trace_id: traceId,
  });
  if (error) {
    const invalid = /INVALID_|NOT_FOUND/.test(error.message);
    return NextResponse.json({ error: error.message }, { status: invalid ? 409 : 500 });
  }
  return NextResponse.json({ success: true, request: data });
}
