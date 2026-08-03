import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { getAppEventEnvironment } from "@/lib/events/environment";

export const runtime = "nodejs";

// GET /api/admin/events/reward-fulfillments?status=pending|approved|scheduled|delivered|on_hold|cancelled
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const status = req.nextUrl.searchParams.get("status");
  const service = createServiceClient();
  const environment = getAppEventEnvironment();

  let query = service
    .from("event_reward_fulfillments")
    .select("id, event_type, event_reference_id, child_id, reward_amount, status, delivery_method, approved_at, delivered_at, admin_note, created_at")
    .eq("environment", environment)
    .order("created_at", { ascending: false });

  if (status && ["pending", "approved", "scheduled", "delivered", "on_hold", "cancelled"].includes(status)) {
    query = query.eq("status", status);
  }

  const { data: rows, error } = await query;
  if (error) {
    console.error("[admin/events/reward-fulfillments] error:", error.message);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const childIds = [...new Set((rows ?? []).map((r) => r.child_id))];
  const { data: children } = childIds.length
    ? await service.from("child_profiles").select("id, name").in("id", childIds)
    : { data: [] };
  const childNameById = new Map((children ?? []).map((c) => [c.id, c.name]));

  const result = (rows ?? []).map((r) => ({ ...r, childName: childNameById.get(r.child_id) ?? null }));
  return NextResponse.json(result);
}
