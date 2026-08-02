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

  // 1. Fetch child_profiles
  const childProfiles: any[] = [];
  let cpOffset = 0;
  while (true) {
    const { data, error } = await service.from("child_profiles").select("id, family_id, is_internal_test, grade").order("id").range(cpOffset, cpOffset + 999);
    if (error) return NextResponse.json({ error: `child_profiles 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    childProfiles.push(...data);
    if (data.length < 1000) break;
    cpOffset += 1000;
  }

  const testFamilyIds = !includeTestAccounts ? await import("@/lib/admin/retentionFilter").then(m => m.getTestFamilyIds(service)) : new Set<string>();

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
    childStats.set(c.id, {
      childId: c.id,
      familyId: c.family_id,
      grade: c.grade || "알 수 없음",
      lastVisitAt: null,
      activeDaysTotal: 0,
      missionCount: 0,
      freechatCount: 0,
      playCount: 0,
      d1Retained: null,
      d7Retained: null,
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
      const d7Str = getOffsetDateStr(firstStr, 7);

      if (ms(d1Str) <= todayMs) {
        stats.d1Retained = stats._meaningfulDates.has(d1Str);
      }
      if (ms(d7Str) <= todayMs) {
        stats.d7Retained = stats._meaningfulDates.has(d7Str);
      }
    }

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
