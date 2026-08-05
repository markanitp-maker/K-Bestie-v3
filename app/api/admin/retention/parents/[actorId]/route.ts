import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getTestFamilyIds } from "@/lib/admin/retentionFilter";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { toKSTDateStr, getOffsetDateStr } from "@/lib/analytics/kstDate";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ actorId: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { actorId } = await params;
  const includeTestAccounts = req.nextUrl.searchParams.get("includeTestAccounts") === "true";
  const service = createServiceClient();

  const nowKST = new Date();
  nowKST.setHours(nowKST.getHours() + 9);
  const todayStr = nowKST.toISOString().slice(0, 10);
  const todayMs = new Date(todayStr + "T00:00:00Z").getTime();
  const ms = (iso: string) => new Date(iso).getTime();

  // 1. Fetch family_members for this actor
  const { data: memberData, error: memberError } = await service.from("family_members")
    .select("id, family_id, user_id, role, joined_at, created_at")
    .eq("user_id", actorId)
    .in("role", ["owner_parent", "parent"])
    .single();

  if (memberError || !memberData || !memberData.family_id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const familyId = memberData.family_id;
  const joinedAt = memberData.joined_at || memberData.created_at;

  // 2. Check if family is test family (any child in the family is test account)
  const { data: childData, error: childError } = await service.from("child_profiles")
    .select("id, is_test_account")
    .eq("family_id", familyId);

  if (childError) {
    return NextResponse.json({ error: `child_profiles 조회 실패: ${childError.message}` }, { status: 500 });
  }

  const isTestFamily = childData?.some(c => c.is_test_account);
  if (!includeTestAccounts && isTestFamily) {
    return NextResponse.json({ error: "not_found" }, { status: 404 }); // 404 for test accounts
  }

  if (!includeTestAccounts) {
    const testFamilyIds = await getTestFamilyIds(service);
    if (testFamilyIds.has(familyId)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
  }

  const connectedChildren = childData?.map(c => c.id) || [];

  // 3. Fetch behavior_events for this parent
  const allEvents: any[] = [];
  let eOffset = 0;
  while (true) {
    const { data, error } = await service.from("behavior_events")
      .select("id, event_name, occurred_at, feature, child_id")
      .eq("actor_id", actorId)
      .eq("actor_type", "parent")
      .eq("is_test_account", false)
      .order("occurred_at", { ascending: false }).order("id", { ascending: false })
      .range(eOffset, eOffset + 999);
    
    if (error) return NextResponse.json({ error: `behavior_events 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    allEvents.push(...data);
    if (data.length < 1000) break;
    eOffset += 1000;
  }

  const loginDates = new Set<string>();
  const loginDatesLast7 = new Set<string>();
  const loginDatesLast30 = new Set<string>();
  let loginEventCount = 0;

  let lastLoginAt: string | null = null;
  let lastMeaningfulActionAt: string | null = null;
  
  const featureUsage: Record<string, number> = {
    daily_report: 0,
    weekly_report: 0,
    conversation_topic: 0
  };

  const timeline = [];
  const prev7Str = getOffsetDateStr(todayStr, -6);
  const prev30Str = getOffsetDateStr(todayStr, -29);
  
  const prev7Ms = ms(prev7Str);
  const prev30Ms = ms(prev30Str);

  for (const e of allEvents) {
    const kstDate = toKSTDateStr(e.occurred_at);
    const eventMs = ms(kstDate);

    if (e.event_name === "parent_login") {
      loginDates.add(kstDate);
      loginEventCount++;
      if (!lastLoginAt || ms(e.occurred_at) > ms(lastLoginAt)) {
        lastLoginAt = e.occurred_at;
      }
      if (eventMs >= prev7Ms && eventMs <= todayMs) loginDatesLast7.add(kstDate);
      if (eventMs >= prev30Ms && eventMs <= todayMs) loginDatesLast30.add(kstDate);
    } else if (e.event_name === "parent_report_view" || e.event_name === "parent_conversation_topic_view") {
      if (!lastMeaningfulActionAt || ms(e.occurred_at) > ms(lastMeaningfulActionAt)) {
        lastMeaningfulActionAt = e.occurred_at;
      }
      if (e.feature) {
        featureUsage[e.feature] = (featureUsage[e.feature] || 0) + 1;
      }
    }

    if (timeline.length < 200) {
      timeline.push({
        occurredAt: e.occurred_at,
        eventName: e.event_name,
        feature: e.feature || "unknown",
        childId: e.child_id || null
      });
    }
  }

  // "평균 주간 방문 횟수" = 가입 이후 실제 경과 기간(부분 주 포함, 소수 주) 기준 총 방문
  // 횟수(로그인 이벤트 수, 방문일 수가 아님)의 평균 — 가입 직후(예: 2일 전 가입)인 부모를
  // 무조건 "1주"로 나눠 실제보다 과소평가하지 않도록 경과 일수를 그대로 7로 나눈 소수
  // 주수를 쓰되, 가입 당일(0일 경과)은 0으로 나누기를 막기 위해 최소 1일로 바닥을 둔다.
  let weeksSinceJoined = 1 / 7;
  if (joinedAt) {
    const joinDateStr = toKSTDateStr(joinedAt);
    const daysSince = Math.max(1, Math.round((todayMs - ms(joinDateStr)) / (1000 * 60 * 60 * 24)));
    weeksSinceJoined = daysSince / 7;
  }

  const avgWeeklyVisits = Number((loginEventCount / weeksSinceJoined).toFixed(1));

  // 4. Fetch attribution
  const { data: attrData } = await service.from("parent_attributions").select("*").eq("parent_user_id", actorId).single();
  let firstTouchLink = null;
  let signupTouchLink = null;
  if (attrData) {
    if (attrData.first_touch_link_id) {
      const { data } = await service.from("acquisition_links").select("link_id, channel_name, utm_source, utm_medium, utm_campaign, utm_content").eq("link_id", attrData.first_touch_link_id).single();
      firstTouchLink = data;
    }
    if (attrData.signup_link_id) {
      const { data } = await service.from("acquisition_links").select("link_id, channel_name, utm_source, utm_medium, utm_campaign, utm_content").eq("link_id", attrData.signup_link_id).single();
      signupTouchLink = data;
    }
  }

  return NextResponse.json({
    actorId,
    familyId,
    joinedAt,
    lastLoginAt,
    lastMeaningfulActionAt,
    activeDaysTotal: loginDates.size,
    activeDaysLast7: loginDatesLast7.size,
    activeDaysLast30: loginDatesLast30.size,
    avgWeeklyVisits,
    connectedChildren,
    featureUsage,
    timeline,
    attribution: attrData ? {
      firstTouchAt: attrData.first_touch_at,
      signupTouchAt: attrData.signup_touch_at,
      firstTouchLink,
      signupTouchLink,
    } : null
  });
}

