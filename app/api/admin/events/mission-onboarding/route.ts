import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { getAppEventEnvironment } from "@/lib/events/environment";
import { getTestFamilyIds } from "@/lib/admin/retentionFilter";

export const runtime = "nodejs";

// GET /api/admin/events/mission-onboarding?status=active|max_completed|completed
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const status = req.nextUrl.searchParams.get("status");
  const includeTestAccounts = req.nextUrl.searchParams.get("includeTestAccounts") === "true";
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

  const childIds = [...new Set((events ?? []).map((e) => e.child_id))];
  const { data: children } = childIds.length
    ? await service.from("child_profiles").select("id, name, member_id, family_id, is_internal_test, is_test_account").in("id", childIds)
    : { data: [] };
  const testFamilyIds = await getTestFamilyIds(service);
  const visibleChildren = (children ?? []).filter((child) => includeTestAccounts || (!child.is_internal_test && !child.is_test_account && !testFamilyIds.has(child.family_id)));
  const visibleChildIds = new Set(visibleChildren.map((child) => child.id));
  const memberIds = visibleChildren.map((child) => child.member_id).filter(Boolean) as string[];
  const familyIds = [...new Set(visibleChildren.map((child) => child.family_id).filter(Boolean))] as string[];
  const [{ data: members }, { data: families }] = await Promise.all([
    memberIds.length ? service.from("family_members").select("id, user_id").in("id", memberIds) : Promise.resolve({ data: [] }),
    familyIds.length ? service.from("families").select("id, name").in("id", familyIds) : Promise.resolve({ data: [] }),
  ]);
  const accountIds = (members ?? []).map((member) => member.user_id).filter(Boolean) as string[];
  const { data: accounts } = accountIds.length
    ? await service.from("member_accounts").select("id, username").in("id", accountIds)
    : { data: [] };
  const usernameByAccountId = new Map((accounts ?? []).map((account) => [account.id, account.username]));
  const accountIdByMemberId = new Map((members ?? []).map((member) => [member.id, member.user_id]));
  const familyNameById = new Map((families ?? []).map((family) => [family.id, family.name]));
  const childById = new Map(visibleChildren.map((child) => [child.id, child]));

  const rows = (events ?? []).filter((event) => visibleChildIds.has(event.child_id)).map((event) => {
    const child = childById.get(event.child_id);
    const accountId = child?.member_id ? accountIdByMemberId.get(child.member_id) : null;
    return {
      ...event,
      childName: child?.name ?? "이름 미등록",
      loginId: accountId ? usernameByAccountId.get(accountId) ?? "미등록" : "미등록",
      familyName: child?.family_id ? familyNameById.get(child.family_id) ?? "이름 없는 가족" : "가족 미등록",
      isInternalTest: Boolean(child?.is_internal_test || child?.is_test_account || (child?.family_id && testFamilyIds.has(child.family_id))),
    };
  });

  return NextResponse.json(rows);
}
