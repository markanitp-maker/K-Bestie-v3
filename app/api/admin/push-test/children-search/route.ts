import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { getTestFamilyIds } from "@/lib/admin/retentionFilter";
import { isPushTestChild } from "@/lib/admin/pushTestEligibility";

export const runtime = "nodejs";

type PushSubscriptionStatus = "알림 등록됨" | "구독 없음" | "권한 거부" | "구독 만료 또는 해제됨";

function getPushSubscriptionStatus(rows: Array<{ is_active: boolean; permission_status: string; revoked_at: string | null }>): PushSubscriptionStatus {
  if (rows.some((row) => row.is_active && row.permission_status === "granted")) return "알림 등록됨";
  if (rows.some((row) => row.permission_status === "denied")) return "권한 거부";
  if (rows.some((row) => row.revoked_at)) return "구독 만료 또는 해제됨";
  return "구독 없음";
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const q = req.nextUrl.searchParams.get("q") || "";
  const service = createServiceClient();

  // 1. Fetch child_profiles
  const { data: children, error: childErr } = await service
    .from("child_profiles")
    .select("id, name, grade, family_id, member_id, is_internal_test, is_test_account");
    
  if (childErr) return NextResponse.json({ error: childErr.message }, { status: 500 });
  if (!children || children.length === 0) return NextResponse.json({ children: [] });
  let testFamilyIds: Set<string>;
  try {
    testFamilyIds = await getTestFamilyIds(service);
  } catch (error) {
    console.error("[admin/push-test/children-search] test family lookup failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "테스트 계정 조회 실패" }, { status: 500 });
  }
  const testChildren = children.filter((child) => isPushTestChild(child, testFamilyIds));
  const testChildIds = testChildren.map((child) => child.id);

  const subscriptionsByChildId = new Map<string, Array<{ is_active: boolean; permission_status: string; revoked_at: string | null }>>();
  if (testChildIds.length > 0) {
    const { data: subscriptions, error: subscriptionError } = await service
      .from("push_subscriptions")
      .select("child_id,is_active,permission_status,revoked_at")
      .eq("role", "child")
      .in("child_id", testChildIds);
    if (subscriptionError) return NextResponse.json({ error: "푸시 구독 상태 조회 실패" }, { status: 500 });
    for (const subscription of subscriptions ?? []) {
      if (!subscription.child_id) continue;
      const rows = subscriptionsByChildId.get(subscription.child_id) ?? [];
      rows.push(subscription);
      subscriptionsByChildId.set(subscription.child_id, rows);
    }
  }

  // 2. Fetch member accounts (for child username)
  // child_profiles.member_id points to family_members.id
  const memberRowIds = Array.from(new Set(testChildren.map(c => c.member_id).filter(Boolean)));
  const authUserIdByMemberRowId = new Map<string, string>();
  if (memberRowIds.length > 0) {
    const { data: fmRows } = await service.from("family_members").select("id, user_id").eq("role", "child").in("id", memberRowIds);
    for (const fm of fmRows || []) {
      if (fm.user_id) authUserIdByMemberRowId.set(fm.id, fm.user_id);
    }
  }
  const authUserIds = Array.from(new Set(authUserIdByMemberRowId.values()));
  const usernameMap = new Map<string, string>();
  if (authUserIds.length > 0) {
    const { data: memberData } = await service.from("member_accounts").select("id, username").in("id", authUserIds);
    for (const m of memberData || []) usernameMap.set(m.id, m.username);
  }

  // 3. Fetch parent email
  const familyIds = Array.from(new Set(testChildren.map(c => c.family_id).filter(Boolean)));
  const parentEmailByFamilyId = new Map<string, string>();
  if (familyIds.length > 0) {
    const { data: parentFmRows } = await service
      .from("family_members")
      .select("family_id, user_id, role")
      .in("role", ["owner_parent", "parent"])
      .in("family_id", familyIds);
      
    if (parentFmRows && parentFmRows.length > 0) {
      const parentUserIds = Array.from(new Set(parentFmRows.map(r => r.user_id).filter(Boolean)));
      if (parentUserIds.length > 0) {
        const { data: parentsData } = await service.from("parents").select("id, email").in("id", parentUserIds);
        const emailMap = new Map<string, string>();
        for (const p of parentsData || []) emailMap.set(p.id, p.email);

        for (const fId of familyIds) {
          const familyParents = parentFmRows.filter(r => r.family_id === fId);
          if (familyParents.length > 0) {
            let targetParent = familyParents.find(r => r.role === "owner_parent");
            if (!targetParent) targetParent = familyParents[0];
            
            if (targetParent && targetParent.user_id) {
              const email = emailMap.get(targetParent.user_id);
              if (email) parentEmailByFamilyId.set(fId, email);
            }
          }
        }
      }
    }
  }

  const result = testChildren.map(c => {
    const authUserId = c.member_id ? authUserIdByMemberRowId.get(c.member_id) : undefined;
    const username = authUserId ? usernameMap.get(authUserId) : undefined;
    const parentEmail = c.family_id ? parentEmailByFamilyId.get(c.family_id) : undefined;

    return {
      id: c.id,
      name: c.name,
      username: username || "",
      grade: c.grade,
      parentEmail: parentEmail || "",
      isTest: true,
      pushSubscriptionStatus: getPushSubscriptionStatus(subscriptionsByChildId.get(c.id) ?? []),
    };
  });

  // Filter by search term
  let filtered = result;
  if (q.trim()) {
    const lowerQ = q.toLowerCase().trim();
    filtered = result.filter(c => 
      (c.name && c.name.toLowerCase().includes(lowerQ)) ||
      (c.username && c.username.toLowerCase().includes(lowerQ))
    );
  }

  // Limit to ~50
  filtered = filtered.slice(0, 50);

  return NextResponse.json({ children: filtered });
}
