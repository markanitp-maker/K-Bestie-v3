import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import {
  isActionableApprovalRequest,
  isCreatedInKstDateRange,
  matchesInternalTestFilter,
  sortAdminUserRows,
  toChildLoginId,
  type InternalTestFilter,
} from "@/lib/admin/userManagement";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Tab = "families" | "parents" | "children";
type RecordRow = Record<string, any>;

const PARENT_ROLES = new Set(["owner_parent", "parent"]);
const PAGE_SIZES = new Set([25, 50, 100]);

function maxIso(values: Array<string | null | undefined>): string | null {
  return values.filter(Boolean).sort().at(-1) ?? null;
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

async function listAuthUsers(service: ReturnType<typeof createServiceClient>) {
  const users: Array<{ id: string; email?: string; created_at: string; last_sign_in_at?: string }> = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}

export async function GET(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const params = request.nextUrl.searchParams;
  const requestedTab = params.get("tab");
  const tab: Tab = requestedTab === "parents" || requestedTab === "children" ? requestedTab : "families";
  const search = (params.get("search") ?? "").trim().toLocaleLowerCase("ko");
  const status = (params.get("status") ?? "all").trim();
  const createdFrom = (params.get("createdFrom") ?? "").trim();
  const createdTo = (params.get("createdTo") ?? "").trim();
  const requestedInternal = params.get("internalTest");
  const internalTest: InternalTestFilter = requestedInternal === "include" || requestedInternal === "only" ? requestedInternal : "exclude";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const parsedPageSize = Number.parseInt(params.get("pageSize") ?? "25", 10);
  const pageSize = PAGE_SIZES.has(parsedPageSize) ? parsedPageSize : 25;
  const sort = params.get("sort") ?? "created_desc";
  const service = createServiceClient();

  try {
    const [familiesResult, membersResult, parentsResult, childrenResult, accountsResult, plansResult, sessionsResult, parentEventsResult, attributionsResult, linksResult, planRequestsResult, childRequestsResult, authUsers] = await Promise.all([
      service.from("families").select("id,name,created_at").is("deleted_at", null),
      service.from("family_members").select("id,family_id,user_id,role,is_internal_test,joined_at,created_at").is("deleted_at", null),
      service.from("parents").select("id,name,email,account_status,approval_status,tier,created_at,onboarding_completed_at,restore_requested_at,withdrawn_at"),
      service.from("child_profiles").select("id,family_id,member_id,name,given_name,family_name,email,grade,gender,tier,is_internal_test,is_test_account,created_at"),
      service.from("member_accounts").select("id,username,email,display_name,role,family_id"),
      service.from("plans").select("tier,name,price_krw"),
      service.from("chat_sessions").select("child_id,session_type,started_at").is("deleted_at", null),
      service.from("behavior_events").select("actor_id,family_id,occurred_at,event_name").eq("actor_type", "parent"),
      service.from("parent_attributions").select("parent_user_id,signup_link_id,first_touch_link_id,signup_touch_at,first_touch_at"),
      service.from("acquisition_links").select("link_id,channel_name,utm_source,utm_medium,utm_campaign").is("deleted_at", null),
      service.from("plan_change_requests").select("id,status,parent_user_id,child_id").is("deleted_at", null),
      service.from("child_approval_requests").select("id,status,family_id,given_name,created_child_id").is("deleted_at", null),
      listAuthUsers(service),
    ]);

    const failed = [familiesResult, membersResult, parentsResult, childrenResult, accountsResult, plansResult, sessionsResult, parentEventsResult, attributionsResult, linksResult, planRequestsResult, childRequestsResult].find((result) => result.error);
    if (failed?.error) throw failed.error;

    const families = familiesResult.data ?? [];
    const activeFamilyIds = new Set(families.map((family) => family.id));
    const members = (membersResult.data ?? []).filter((member) => activeFamilyIds.has(member.family_id));
    const parents = parentsResult.data ?? [];
    const children = (childrenResult.data ?? []).filter((child) => activeFamilyIds.has(child.family_id));
    const accounts = accountsResult.data ?? [];
    const plans = plansResult.data ?? [];
    const sessions = sessionsResult.data ?? [];
    const parentEvents = parentEventsResult.data ?? [];

    const familyById = new Map(families.map((family) => [family.id, family]));
    const parentById = new Map(parents.map((parent) => [parent.id, parent]));
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    const planByTier = new Map(plans.map((plan) => [plan.tier, plan]));
    const authById = new Map(authUsers.map((user) => [user.id, user]));
    const memberById = new Map(members.map((member) => [member.id, member]));
    const childAuthIds = new Set(members.filter((member) => member.role === "child" && member.user_id).map((member) => member.user_id));

    const membersByFamily = new Map<string, RecordRow[]>();
    for (const member of members) {
      const list = membersByFamily.get(member.family_id) ?? [];
      list.push(member);
      membersByFamily.set(member.family_id, list);
    }
    const childrenByFamily = new Map<string, RecordRow[]>();
    for (const child of children) {
      const list = childrenByFamily.get(child.family_id) ?? [];
      list.push(child);
      childrenByFamily.set(child.family_id, list);
    }

    const testFamilyIds = new Set<string>();
    for (const member of members) if (member.is_internal_test) testFamilyIds.add(member.family_id);
    for (const child of children) if (child.is_internal_test || child.is_test_account) testFamilyIds.add(child.family_id);

    const lastSessionByChild = new Map<string, string>();
    const sessionCountsByChild = new Map<string, Record<string, number>>();
    for (const session of sessions) {
      const previous = lastSessionByChild.get(session.child_id);
      if (!previous || session.started_at > previous) lastSessionByChild.set(session.child_id, session.started_at);
      const counts = sessionCountsByChild.get(session.child_id) ?? {};
      counts[session.session_type ?? "unknown"] = (counts[session.session_type ?? "unknown"] ?? 0) + 1;
      sessionCountsByChild.set(session.child_id, counts);
    }
    const lastParentActivityById = new Map<string, string>();
    for (const event of parentEvents) {
      if (!event.actor_id) continue;
      const previous = lastParentActivityById.get(event.actor_id);
      if (!previous || event.occurred_at > previous) lastParentActivityById.set(event.actor_id, event.occurred_at);
    }

    const linkById = new Map((linksResult.data ?? []).map((link) => [link.link_id, link]));
    const attributionByParent = new Map((attributionsResult.data ?? []).map((attribution) => [attribution.parent_user_id, attribution]));
    const channelForParent = (parentId: string) => {
      const attribution = attributionByParent.get(parentId);
      const link = attribution ? linkById.get(attribution.signup_link_id ?? attribution.first_touch_link_id) : null;
      return link?.channel_name || [link?.utm_source, link?.utm_medium].filter(Boolean).join(" / ") || "기존 가입자";
    };

    const parentMembers = members.filter((member) => PARENT_ROLES.has(member.role) && member.user_id);
    const parentMemberByUser = new Map(parentMembers.map((member) => [member.user_id, member]));
    const parentCandidates = parents.filter((parent) => parentMemberByUser.has(parent.id) || (parent.account_status === "ONBOARDING" && !childAuthIds.has(parent.id)));

    const familyRows = families.map((family) => {
      const familyMembers = membersByFamily.get(family.id) ?? [];
      const familyParents = familyMembers.filter((member) => PARENT_ROLES.has(member.role)).map((member) => {
        const parent = parentById.get(member.user_id);
        return parent ? { id: parent.id, name: parent.name || "이름 미등록", email: parent.email || authById.get(parent.id)?.email || "", role: member.role, status: parent.account_status, tier: parent.tier } : null;
      }).filter(Boolean) as RecordRow[];
      const familyChildren = (childrenByFamily.get(family.id) ?? []).map((child) => {
        const member = memberById.get(child.member_id);
        const account = member?.user_id ? accountById.get(member.user_id) : null;
        return { id: child.id, name: child.name || [child.family_name, child.given_name].filter(Boolean).join("") || "이름 미등록", loginId: toChildLoginId(account?.username || child.email || account?.email), grade: child.grade, gender: child.gender, tier: child.tier, isTest: Boolean(child.is_internal_test || child.is_test_account) };
      });
      const representative = familyParents.find((parent) => parent.role === "owner_parent") ?? familyParents[0];
      const name = family.name?.trim() || (representative?.name ? `${representative.name} 가족` : "이름 없는 가족");
      const planNames = [...new Set(familyChildren.map((child) => planByTier.get(child.tier)?.name || `Tier ${child.tier}`))];
      const familyParentActivity = familyParents.map((parent) => lastParentActivityById.get(parent.id));
      const lastActivityAt = maxIso([
        ...familyChildren.map((child) => lastSessionByChild.get(child.id)),
        ...familyParentActivity,
      ]);
      const flags = [...familyMembers.map((member) => Boolean(member.is_internal_test)), ...familyChildren.map((child) => child.isTest)];
      const testLabel = flags.length > 0 && flags.every(Boolean) ? "테스트" : flags.some(Boolean) ? "혼합" : "일반";
      return { id: family.id, type: "family", name, displayName: name, parents: familyParents, children: familyChildren, parentCount: familyParents.length, childCount: familyChildren.length, planNames, createdAt: family.created_at, lastActivityAt, isTest: testFamilyIds.has(family.id), testLabel, status: "활성" };
    });

    const parentRows = parentCandidates.map((parent) => {
      const membership = parentMemberByUser.get(parent.id);
      const family = membership ? familyById.get(membership.family_id) : null;
      const familyChildren = membership ? childrenByFamily.get(membership.family_id) ?? [] : [];
      const auth = authById.get(parent.id);
      const isTest = membership ? testFamilyIds.has(membership.family_id) || Boolean(membership.is_internal_test) : false;
      return { id: parent.id, type: "parent", name: parent.name || "이름 미등록", displayName: parent.name || "이름 미등록", email: parent.email || auth?.email || "", familyId: family?.id ?? null, familyName: family?.name?.trim() || (family ? `${parent.name || "이름 미등록"} 가족` : "가족 연결 전"), children: familyChildren.map((child) => ({ id: child.id, name: child.name || "이름 미등록" })), childCount: familyChildren.length, tier: parent.tier, planName: planByTier.get(parent.tier)?.name || `Tier ${parent.tier}`, channel: channelForParent(parent.id), createdAt: auth?.created_at || parent.created_at, lastSignInAt: auth?.last_sign_in_at || lastParentActivityById.get(parent.id) || null, lastActivityAt: lastParentActivityById.get(parent.id) || null, status: parent.account_status, approvalStatus: parent.approval_status, onboardingCompletedAt: parent.onboarding_completed_at, isTest };
    });

    const childRows = children.filter((child) => {
      const member = memberById.get(child.member_id);
      return member?.role === "child";
    }).map((child) => {
      const member = memberById.get(child.member_id)!;
      const account = member.user_id ? accountById.get(member.user_id) : null;
      const auth = member.user_id ? authById.get(member.user_id) : null;
      const family = familyById.get(child.family_id);
      const familyParents = (membersByFamily.get(child.family_id) ?? []).filter((row) => PARENT_ROLES.has(row.role)).map((row) => parentById.get(row.user_id)?.name).filter(Boolean);
      const isTest = testFamilyIds.has(child.family_id) || Boolean(child.is_internal_test || child.is_test_account || member.is_internal_test);
      return { id: child.id, type: "child", name: child.name || [child.family_name, child.given_name].filter(Boolean).join("") || "이름 미등록", displayName: child.name || "이름 미등록", loginId: toChildLoginId(account?.username || child.email || account?.email || auth?.email), email: child.email || account?.email || auth?.email || "", grade: child.grade || "미등록", gender: child.gender, familyId: child.family_id, familyName: family?.name?.trim() || (familyParents[0] ? `${familyParents[0]} 가족` : "이름 없는 가족"), parents: familyParents, tier: child.tier, planName: planByTier.get(child.tier)?.name || `Tier ${child.tier}`, approval: "등록 완료", createdAt: child.created_at, lastActivityAt: lastSessionByChild.get(child.id) || null, lastSignInAt: auth?.last_sign_in_at || null, sessionCounts: sessionCountsByChild.get(child.id) ?? {}, isTest };
    });

    const rawRows: RecordRow[] = tab === "parents" ? parentRows : tab === "children" ? childRows : familyRows;
    const filterable = rawRows.filter((row) => matchesInternalTestFilter(Boolean(row.isTest), internalTest));
    const counts = {
      families: familyRows.filter((row) => matchesInternalTestFilter(Boolean(row.isTest), internalTest)).length,
      parents: parentRows.filter((row) => matchesInternalTestFilter(Boolean(row.isTest), internalTest)).length,
      children: childRows.filter((row) => matchesInternalTestFilter(Boolean(row.isTest), internalTest)).length,
      pending: parents.filter((parent) => parent.account_status === "RESTORE_REQUESTED").length
        + (planRequestsResult.data ?? []).filter((row) => row.status === "pending").length
        + (childRequestsResult.data ?? []).filter((row) => isActionableApprovalRequest(row, children)).length,
    };
    const searched = filterable.filter((row) => {
      if (status !== "all" && String(row.status ?? row.approval ?? "") !== status) return false;
      if (!isCreatedInKstDateRange(row.createdAt, createdFrom, createdTo)) return false;
      if (!search) return true;
      return JSON.stringify({ name: row.name, email: row.email, loginId: row.loginId, familyName: row.familyName, parents: row.parents, children: row.children }).toLocaleLowerCase("ko").includes(search);
    });
    const ordered = sortAdminUserRows(searched, sort);

    if (params.get("format") === "csv") {
      const headers = tab === "families"
        ? ["가족", "부모", "아이", "요금제", "생성일", "최근 활동", "테스트", "상태"]
        : tab === "parents"
          ? ["부모", "이메일", "가족", "연결 아이", "요금제", "가입 채널", "가입일", "최근 접속", "상태", "테스트"]
          : ["아이", "로그인 아이디", "학년", "성별", "가족", "부모", "요금제", "생성일", "최근 활동", "테스트"];
      const values = ordered.map((row) => tab === "families"
        ? [row.name, row.parents.map((parent: RecordRow) => parent.name).join(" / "), row.children.map((child: RecordRow) => child.name).join(" / "), row.planNames.join(" / "), row.createdAt, row.lastActivityAt, row.testLabel, row.status]
        : tab === "parents"
          ? [row.name, row.email, row.familyName, row.children.map((child: RecordRow) => child.name).join(" / "), row.planName, row.channel, row.createdAt, row.lastSignInAt, row.status, row.isTest ? "테스트" : "일반"]
          : [row.name, row.loginId, row.grade, row.gender || "", row.familyName, row.parents.join(" / "), row.planName, row.createdAt, row.lastActivityAt, row.isTest ? "테스트" : "일반"]);
      const csv = `\uFEFF${[headers, ...values].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
      return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="admin-users-${tab}.csv"`, "Cache-Control": "no-store" } });
    }

    const total = ordered.length;
    const start = (page - 1) * pageSize;
    return NextResponse.json({ tab, counts, kpi: counts, items: ordered.slice(start, start + pageSize), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }, meta: { internalTest, searchApplied: Boolean(search), generatedAt: new Date().toISOString(), timezone: "Asia/Seoul", softDeletedExcluded: true } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[admin/users/overview]", error);
    const emptyCounts = { families: 0, parents: 0, children: 0, pending: 0 };
    return NextResponse.json({
      error: "사용자 관리 데이터를 불러오지 못했습니다.",
      tab,
      counts: emptyCounts,
      kpi: emptyCounts,
      items: [],
      pagination: { page, pageSize, total: 0, totalPages: 1 },
      meta: { internalTest, searchApplied: Boolean(search), generatedAt: new Date().toISOString(), timezone: "Asia/Seoul", softDeletedExcluded: true },
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
