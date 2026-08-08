import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { getAppEventEnvironment } from "@/lib/events/environment";
import { getTestFamilyIds } from "@/lib/admin/retentionFilter";

export const runtime = "nodejs";

interface RewardAuditHistoryRow {
  resource_id: string;
  action: string;
  admin_email: string;
  before_snapshot: Record<string, unknown> | null;
  after_snapshot: Record<string, unknown> | null;
  created_at: string;
  request_id: string | null;
}

// GET /api/admin/events/reward-fulfillments?status=pending|approved|scheduled|delivered|on_hold|cancelled
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const status = req.nextUrl.searchParams.get("status");
  const includeTestAccounts = req.nextUrl.searchParams.get("includeTestAccounts") === "true";
  const service = createServiceClient();
  const environment = getAppEventEnvironment();

  let query = service
    .from("event_reward_fulfillments")
    .select("id, event_type, event_reference_id, child_id, reward_amount, status, delivery_method, approved_at, delivered_at, admin_note, created_at")
    .eq("environment", environment)
    // requests/066 소프트 삭제 — 삭제된 지급 이력은 목록·통계·검색에서 제외한다.
    .is("deleted_at", null)
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
  const rewardIds = (rows ?? []).map((row) => row.id);
  const { data: children } = childIds.length
    ? await service.from("child_profiles").select("id, name, member_id, family_id, is_internal_test, is_test_account").in("id", childIds)
    : { data: [] };
  const testFamilyIds = await getTestFamilyIds(service);
  const visibleChildren = (children ?? []).filter((child) => includeTestAccounts || (!child.is_internal_test && !child.is_test_account && !testFamilyIds.has(child.family_id)));
  const childById = new Map(visibleChildren.map((child) => [child.id, child]));
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
  const accountIdByMemberId = new Map((members ?? []).map((member) => [member.id, member.user_id]));
  const usernameByAccountId = new Map((accounts ?? []).map((account) => [account.id, account.username]));
  const familyNameById = new Map((families ?? []).map((family) => [family.id, family.name]));

  const { data: audits, error: auditError } = rewardIds.length
    ? await service
        .from("admin_audit_log")
        .select("resource_id,action,admin_email,before_snapshot,after_snapshot,created_at,request_id")
        .eq("resource_type", "event_reward_fulfillments")
        .in("resource_id", rewardIds)
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (auditError) console.error("[admin/events/reward-fulfillments] audit history error:", auditError.message);
  const auditsByReward = new Map<string, RewardAuditHistoryRow[]>();
  for (const audit of (audits ?? []) as RewardAuditHistoryRow[]) {
    const history = auditsByReward.get(audit.resource_id) ?? [];
    history.push(audit);
    auditsByReward.set(audit.resource_id, history);
  }

  const result = (rows ?? []).filter((row) => childById.has(row.child_id)).map((row) => {
    const child = childById.get(row.child_id);
    const accountId = child?.member_id ? accountIdByMemberId.get(child.member_id) : null;
    return {
      ...row,
      childName: child?.name ?? "이름 미등록",
      loginId: accountId ? usernameByAccountId.get(accountId) ?? "미등록" : "미등록",
      familyName: child?.family_id ? familyNameById.get(child.family_id) ?? "이름 없는 가족" : "가족 미등록",
      isInternalTest: Boolean(child?.is_internal_test || child?.is_test_account || (child?.family_id && testFamilyIds.has(child.family_id))),
      auditHistory: auditsByReward.get(row.id) ?? [],
    };
  });
  return NextResponse.json(result);
}
