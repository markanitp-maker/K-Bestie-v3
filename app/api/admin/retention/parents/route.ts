import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { toKSTDateStr, getOffsetDateStr } from "@/lib/analytics/kstDate";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const includeTestAccounts = req.nextUrl.searchParams.get("includeTestAccounts") === "true";

  const nowKST = new Date();
  nowKST.setHours(nowKST.getHours() + 9);
  const todayStr = nowKST.toISOString().slice(0, 10);
  const todayMs = new Date(todayStr + "T00:00:00Z").getTime();
  
  const ms = (iso: string) => new Date(iso).getTime();

  const service = createServiceClient();

  // 1. Fetch child_profiles to identify test families
  const childProfiles: any[] = [];
  let cpOffset = 0;
  while (true) {
    const { data, error } = await service.from("child_profiles").select("id, family_id, is_test_account").order("id").range(cpOffset, cpOffset + 999);
    if (error) return NextResponse.json({ error: `child_profiles 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    childProfiles.push(...data);
    if (data.length < 1000) break;
    cpOffset += 1000;
  }

  const testFamilyIds = new Set<string>();
  if (!includeTestAccounts) {
    for (const c of childProfiles) {
      if (c.is_test_account && c.family_id) {
        testFamilyIds.add(c.family_id);
      }
    }
  }

  // 2. Fetch family_members
  const familyMembers: any[] = [];
  let fmOffset = 0;
  while (true) {
    const { data, error } = await service.from("family_members")
      .select("id, family_id, user_id, role, joined_at, created_at")
      .in("role", ["owner_parent", "parent"])
      .not("user_id", "is", null)
      .not("family_id", "is", null)
      .order("id")
      .range(fmOffset, fmOffset + 999);
    if (error) return NextResponse.json({ error: `family_members 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    familyMembers.push(...data);
    if (data.length < 1000) break;
    fmOffset += 1000;
  }

  const validParents = [];
  for (const fm of familyMembers) {
    if (!includeTestAccounts && testFamilyIds.has(fm.family_id)) continue;
    validParents.push({
      actorId: fm.user_id,
      familyId: fm.family_id,
      joinedAt: fm.joined_at || fm.created_at,
    });
  }

  // 3. Fetch behavior_events for parents
  const allEvents: any[] = [];
  let eOffset = 0;
  while (true) {
    let q = service.from("behavior_events")
      .select("id, event_name, actor_id, occurred_at")
      .eq("actor_type", "parent")
      .order("occurred_at").order("id")
      .range(eOffset, eOffset + 999);
    
    if (!includeTestAccounts) {
      q = q.eq("is_test_account", false);
    }
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: `behavior_events 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    allEvents.push(...data);
    if (data.length < 1000) break;
    eOffset += 1000;
  }

  // Calculate metrics per parent
  const parentStats = new Map<string, any>();
  for (const p of validParents) {
    parentStats.set(p.actorId, {
      ...p,
      lastVisitAt: null,
      activeDaysTotal: 0,
      visitCount: 0,
      reportViewCount: 0,
      topicViewCount: 0,
      status: "가입 후 의미 행동 없음",
      _meaningfulDates: new Set<string>(),
      _loginDates: new Set<string>(),
    });
  }

  for (const e of allEvents) {
    if (!e.actor_id || !parentStats.has(e.actor_id)) continue;
    const stats = parentStats.get(e.actor_id);
    const kstDate = toKSTDateStr(e.occurred_at);

    if (e.event_name === "parent_login") {
      stats.visitCount++;
      stats._loginDates.add(kstDate);
      if (!stats.lastVisitAt || ms(e.occurred_at) > ms(stats.lastVisitAt)) {
        stats.lastVisitAt = e.occurred_at;
      }
    } else if (e.event_name === "parent_report_view") {
      stats.reportViewCount++;
      stats._meaningfulDates.add(kstDate);
    } else if (e.event_name === "parent_conversation_topic_view") {
      stats.topicViewCount++;
      stats._meaningfulDates.add(kstDate);
    }
  }

  const prev2Str = getOffsetDateStr(todayStr, -2);
  const prev6Str = getOffsetDateStr(todayStr, -6);
  const prev2Ms = ms(prev2Str);
  const prev6Ms = ms(prev6Str);

  const parentsResult = [];
  for (const stats of parentStats.values()) {
    stats.activeDaysTotal = stats._loginDates.size;

    if (stats._meaningfulDates.size > 0) {
      // "최근 7일 미접속"이 실제로 "지난 7일간 의미있는 행동이 없었다"는 뜻이 되도록,
      // 가장 최근 의미있는 행동일을 구해 경계를 정확히 판정한다(이전에는 오늘/최근3일이
      // 아니면 무조건 이 상태로 분류해, 실제로는 4~6일 전에 활동한 부모도 "미접속"으로
      // 잘못 표시됐다 — codex 지적).
      const mostRecentMeaningfulMs = Math.max(...Array.from(stats._meaningfulDates, (d: string) => ms(d)));
      if (stats._meaningfulDates.has(todayStr)) {
        stats.status = "오늘 활성";
      } else if (mostRecentMeaningfulMs >= prev2Ms) {
        stats.status = "최근 3일 활성";
      } else if (mostRecentMeaningfulMs >= prev6Ms) {
        stats.status = "최근 7일 활성";
      } else {
        stats.status = "최근 7일 미접속";
      }
    } else {
      stats.status = "가입 후 의미 행동 없음";
    }

    delete stats._meaningfulDates;
    delete stats._loginDates;
    parentsResult.push(stats);
  }

  return NextResponse.json({
    parents: parentsResult,
    meta: {
      testAccountsExcluded: !includeTestAccounts,
      timezone: "Asia/Seoul",
      generatedAt: new Date().toISOString()
    }
  });
}
