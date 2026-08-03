import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { getAppEventEnvironment } from "@/lib/events/environment";

export const runtime = "nodejs";

// GET /api/admin/events/mission-onboarding?status=active|max_completed|completed
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const status = req.nextUrl.searchParams.get("status");
  const service = createServiceClient();
  const environment = getAppEventEnvironment();

  let query = service
    .from("child_mission_onboarding_events")
    .select("id, child_id, status, started_at, ends_at, completed_at, mission_completed_count, final_mission_count, current_reward_amount, final_reward_amount")
    .eq("environment", environment)
    .order("started_at", { ascending: false });

  if (status && ["active", "max_completed", "completed"].includes(status)) {
    query = query.eq("status", status);
  }

  const { data: events, error } = await query;
  if (error) {
    console.error("[admin/events/mission-onboarding] error:", error.message);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const childIds = (events ?? []).map((e) => e.child_id);
  const { data: children } = childIds.length
    ? await service.from("child_profiles").select("id, name, member_id").in("id", childIds)
    : { data: [] };
  const childNameById = new Map((children ?? []).map((c) => [c.id, c.name]));

  const rows = (events ?? []).map((e) => ({
    ...e,
    childName: childNameById.get(e.child_id) ?? null,
  }));

  return NextResponse.json(rows);
}
