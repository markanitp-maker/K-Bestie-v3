import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { toKSTDateStr, getOffsetDateStr } from "@/lib/analytics/kstDate";
import { toDisplayFields } from "@/lib/admin/retentionDisplay";

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

  // 1. Fetch child_profiles
  const childProfiles: any[] = [];
  let cpOffset = 0;
  while (true) {
    const { data, error } = await service.from("child_profiles").select("id, family_id, is_internal_test, grade, name, member_id").order("id").range(cpOffset, cpOffset + 999);
    if (error) return NextResponse.json({ error: `child_profiles 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    childProfiles.push(...data);
    if (data.length < 1000) break;
    cpOffset += 1000;
  }

  const allTestFamilyIds = await import("@/lib/admin/retentionFilter").then(m => m.getTestFamilyIds(service));
  const testFamilyIds = !includeTestAccounts ? allTestFamilyIds : new Set<string>();

  const validChildren = [];
  for (const c of childProfiles) {
    if (includeTestAccounts) {
      validChildren.push(c);
    } else {
      if (!c.is_internal_test && (!c.family_id || !testFamilyIds.has(c.family_id))) {
        validChildren.push(c);
      }
    }
  }

  // 이름·로그인 아이디 조인(child_profiles.member_id → family_members.id → family_members.user_id
  // → member_accounts.id). child_profiles.member_id는 family_members 행의 PK를 가리키지
  // member_accounts.id(실제 auth uid)를 직접 가리키지 않는다 — 승인 시점 실제 insert 순서
  // (app/api/admin/child-approval-requests/[id]/approve/route.ts)를 보면
  // family_members.insert({user_id: authUserId}) → familyMember.id 로 member_accounts.insert({id: authUserId})
  // → child_profiles.insert({member_id: familyMember.id}) 순이라, member_id를 member_accounts.id로
  // 바로 조회하면 항상 매칭에 실패해 로그인 아이디가 비어 보이는 버그가 있었다. family_members를
  // 한 단계 거쳐 실제 auth uid를 구한 뒤 member_accounts를 조회한다.
  const memberRowIds = Array.from(new Set(validChildren.map(c => c.member_id).filter(Boolean)));
  const authUserIdByMemberRowId = new Map<string, string>();
  if (memberRowIds.length > 0) {
    const { data: fmRows } = await service.from("family_members").select("id, user_id").eq("role", "child").in("id", memberRowIds);
    for (const fm of fmRows || []) {
      if (fm.user_id) authUserIdByMemberRowId.set(fm.id, fm.user_id);
    }
  }
  const authUserIds = Array.from(new Set(Array.from(authUserIdByMemberRowId.values())));
  const usernameMap = new Map<string, string>();
  if (authUserIds.length > 0) {
    const { data: memberData } = await service.from("member_accounts").select("id, username").in("id", authUserIds);
    for (const m of memberData || []) usernameMap.set(m.id, m.username);
  }

  // 2. Fetch behavior_events for children
  const allEvents: any[] = [];
  let eOffset = 0;
  while (true) {
    let q = service.from("behavior_events")
      .select("id, event_name, child_id, occurred_at")
      .eq("actor_type", "child")
      .order("occurred_at").order("id")
      .range(eOffset, eOffset + 999);
    
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: `behavior_events 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    allEvents.push(...data);
    if (data.length < 1000) break;
    eOffset += 1000;
  }

  // 3. Process metrics
  const childStats = new Map<string, any>();
  for (const c of validChildren) {
    const authUserId = c.member_id ? authUserIdByMemberRowId.get(c.member_id) : undefined;
    const username = authUserId ? usernameMap.get(authUserId) : undefined;
    childStats.set(c.id, {
      childId: c.id,
      familyId: c.family_id,
      grade: c.grade || "알 수 없음",
      ...toDisplayFields(c.id, c.name, username),
      isTestAccount: allTestFamilyIds.has(c.family_id) || !!c.is_internal_test,
      lastVisitAt: null,
      activeDaysTotal: 0,
      missionCount: 0,
      freechatCount: 0,
      playCount: 0,
      d1Retained: null,
      d3Retained: null,
      d7Retained: null,
      w2Retained: null,
      _firstMeaningfulDate: null,
      _meaningfulDates: new Set<string>(),
      _loginDates: new Set<string>()
    });
  }

  const MEANINGFUL_EVENTS = ['mission_start', 'freechat_start', 'play_start'];

  for (const e of allEvents) {
    if (!e.child_id || !childStats.has(e.child_id)) continue;
    const stats = childStats.get(e.child_id);
    const kstDate = toKSTDateStr(e.occurred_at);

    if (e.event_name === "child_login") {
      stats._loginDates.add(kstDate);
      if (!stats.lastVisitAt || ms(e.occurred_at) > ms(stats.lastVisitAt)) {
        stats.lastVisitAt = e.occurred_at;
      }
    } else if (e.event_name === "mission_start") {
      stats.missionCount++;
      stats._meaningfulDates.add(kstDate);
      if (!stats._firstMeaningfulDate) stats._firstMeaningfulDate = kstDate;
    } else if (e.event_name === "freechat_start") {
      stats.freechatCount++;
      stats._meaningfulDates.add(kstDate);
      if (!stats._firstMeaningfulDate) stats._firstMeaningfulDate = kstDate;
    } else if (e.event_name === "play_start") {
      stats.playCount++;
      stats._meaningfulDates.add(kstDate);
      if (!stats._firstMeaningfulDate) stats._firstMeaningfulDate = kstDate;
    }
  }

  const childrenResult = [];
  for (const stats of childStats.values()) {
    stats.activeDaysTotal = stats._loginDates.size;

    if (stats._firstMeaningfulDate) {
      const firstStr = stats._firstMeaningfulDate;
      const d1Str = getOffsetDateStr(firstStr, 1);
      const d3Str = getOffsetDateStr(firstStr, 3);
      const d7Str = getOffsetDateStr(firstStr, 7);

      if (ms(d1Str) <= todayMs) {
        stats.d1Retained = stats._meaningfulDates.has(d1Str);
      }
      if (ms(d3Str) <= todayMs) {
        stats.d3Retained = stats._meaningfulDates.has(d3Str);
      }
      if (ms(d7Str) <= todayMs) {
        stats.d7Retained = stats._meaningfulDates.has(d7Str);
      }

      const w2StartStr = getOffsetDateStr(firstStr, 8);
      const w2EndStr = getOffsetDateStr(firstStr, 14);
      if (ms(w2EndStr) <= todayMs) {
        let visited = false;
        for (const d of stats._meaningfulDates as Set<string>) {
          if (ms(d) >= ms(w2StartStr) && ms(d) <= ms(w2EndStr)) { visited = true; break; }
        }
        stats.w2Retained = visited;
      }
    }

    stats.firstActiveDate = stats._firstMeaningfulDate;
    delete stats._firstMeaningfulDate;
    delete stats._meaningfulDates;
    delete stats._loginDates;
    childrenResult.push(stats);
  }

  return NextResponse.json({
    children: childrenResult,
    meta: {
      testAccountsExcluded: !includeTestAccounts,
      timezone: "Asia/Seoul",
      generatedAt: new Date().toISOString()
    }
  });
}
