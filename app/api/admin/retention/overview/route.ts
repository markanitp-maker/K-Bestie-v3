import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getTestFamilyIds } from "@/lib/admin/retentionFilter";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { getOffsetDateStr } from "@/lib/analytics/kstDate";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const periodParam = req.nextUrl.searchParams.get("period") || "7d";
  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const includeTestAccounts = req.nextUrl.searchParams.get("includeTestAccounts") === "true";

  const nowKST = new Date();
  nowKST.setHours(nowKST.getHours() + 9);
  const todayStr = nowKST.toISOString().slice(0, 10);

  let fromStr = todayStr;
  let toStr = todayStr;

  if (periodParam === "custom" && fromParam && toParam) {
    fromStr = fromParam;
    toStr = toParam;
  } else if (periodParam === "today") {
    // defaults to today
  } else if (periodParam === "14d") {
    fromStr = getOffsetDateStr(todayStr, -13);
  } else if (periodParam === "30d") {
    fromStr = getOffsetDateStr(todayStr, -29);
  } else {
    fromStr = getOffsetDateStr(todayStr, -6);
  }

  const daysDiff = Math.round((new Date(toStr + "T00:00:00Z").getTime() - new Date(fromStr + "T00:00:00Z").getTime()) / (1000 * 60 * 60 * 24));
  const prevToStr = getOffsetDateStr(fromStr, -1);
  const prevFromStr = getOffsetDateStr(prevToStr, -daysDiff);

  const fromIso = fromStr + "T00:00:00+09:00";
  const toIso = toStr + "T23:59:59.999+09:00";
  const prevFromIso = prevFromStr + "T00:00:00+09:00";
  const prevToIso = prevToStr + "T23:59:59.999+09:00";

  // occurred_at/started_at/created_at은 Postgres timestamptz라 보통 +00:00(UTC) 형식
  // 문자열로 돌아오는데, 아래 경계값들은 +09:00(KST) 리터럴로 만들어진다 — 서로 다른
  // 오프셋의 ISO 문자열을 그냥 >=/<= 로 비교하면(사전식 문자열 비교) 실제 시각 순서와
  // 어긋난다(최대 9시간 오차). 반드시 실제 시각(epoch ms)으로 변환해서 비교한다.
  const toMs = (iso: string) => new Date(iso).getTime();

  const service = createServiceClient();

  // 1. Identify test families & valid children
  let childProfiles: any[] = [];
  let cpOffset = 0;
  while (true) {
    const { data, error } = await service.from("child_profiles").select("id, family_id, is_internal_test").range(cpOffset, cpOffset + 999);
    if (error) return NextResponse.json({ error: `child_profiles 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    childProfiles.push(...data);
    if (data.length < 1000) break;
    cpOffset += 1000;
  }
  const testFamilyIds = !includeTestAccounts ? await getTestFamilyIds(service) : new Set<string>();

  const validChildIds = new Set<string>();
  if (childProfiles) {
    for (const c of childProfiles) {
      if (includeTestAccounts) {
        validChildIds.add(c.id);
      } else {
        if (!c.is_internal_test && (!c.family_id || !testFamilyIds.has(c.family_id))) {
          validChildIds.add(c.id);
        }
      }
    }
  }

  // 2. Fetch families
  let allFamilies: any[] = [];
  let fOffset = 0;
  while (true) {
    const { data, error } = await service.from("families").select("id, created_at").range(fOffset, fOffset + 999);
    if (error) return NextResponse.json({ error: `families 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    allFamilies.push(...data);
    if (data.length < 1000) break;
    fOffset += 1000;
  }
  if (!includeTestAccounts) {
    allFamilies = allFamilies.filter(f => !testFamilyIds.has(f.id));
  }

  // 3. Fetch behavior_events
  let allEvents: any[] = [];
  let eOffset = 0;
  while (true) {
    let q = service.from("behavior_events")
      .select("id, event_name, actor_type, actor_id, family_id, child_id, occurred_at, feature")
      .gte("occurred_at", prevFromIso)
      .lte("occurred_at", toIso)
      .range(eOffset, eOffset + 999);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: `behavior_events 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    allEvents.push(...data);
    if (data.length < 1000) break;
    eOffset += 1000;
  }
  if (!includeTestAccounts) {
    allEvents = allEvents.filter(e => !e.family_id || !testFamilyIds.has(e.family_id));
  }

  // 4. Fetch chat_sessions
  let allSessions: any[] = [];
  let sOffset = 0;
  while (true) {
    const { data, error } = await service.from("chat_sessions")
      .select("id, child_id, started_at, ended_at, demo_mode")
      .is("deleted_at", null)
      .gte("started_at", prevFromIso)
      .lte("started_at", toIso)
      .range(sOffset, sOffset + 999);
    if (error) return NextResponse.json({ error: `chat_sessions 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    allSessions.push(...data);
    if (data.length < 1000) break;
    sOffset += 1000;
  }
  allSessions = allSessions.filter(s => s.demo_mode !== true && s.child_id && validChildIds.has(s.child_id));

  // Split into current and previous periods (전부 epoch ms 비교)
  const fromMs = toMs(fromIso);
  const toMsVal = toMs(toIso);
  const prevFromMs = toMs(prevFromIso);

  const curEvents = allEvents.filter(e => toMs(e.occurred_at) >= fromMs && toMs(e.occurred_at) <= toMsVal);
  const prevEvents = allEvents.filter(e => toMs(e.occurred_at) >= prevFromMs && toMs(e.occurred_at) < fromMs);

  const curSessions = allSessions.filter(s => toMs(s.started_at) >= fromMs && toMs(s.started_at) <= toMsVal);
  const prevSessions = allSessions.filter(s => toMs(s.started_at) >= prevFromMs && toMs(s.started_at) < fromMs);

  // Helper functions
  const calcFamilies = (beforeIso: string) => allFamilies.filter(f => toMs(f.created_at) <= toMs(beforeIso)).length;
  const calcNewFamilies = (fIso: string, tIso: string) => allFamilies.filter(f => toMs(f.created_at) >= toMs(fIso) && toMs(f.created_at) <= toMs(tIso)).length;

  const countDistinct = (events: any[], key: string, filterFn?: (e: any) => boolean) => {
    const s = new Set();
    for (const e of events) {
      if ((!filterFn || filterFn(e)) && e[key]) s.add(e[key]);
    }
    return s.size;
  };

  const countEvents = (events: any[], filterFn: (e: any) => boolean) => events.filter(filterFn).length;

  const calcSessionStats = (sessions: any[]) => {
    let totalDur = 0;
    let count = 0;
    for (const s of sessions) {
      if (s.started_at && s.ended_at) {
        const dur = (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000;
        if (dur > 0 && dur < 86400) { // filter out absurd durations
          totalDur += dur;
          count++;
        }
      }
    }
    return {
      total: sessions.length,
      avg: count > 0 ? totalDur / count : 0
    };
  };

  // "활성 가족"은 스펙(§6.6)상 로그인만으로는 인정하지 않고, 부모 또는 아이 중 한 명이라도
  // 의미 있는 행동(미션/자유대화/놀이 시작, 리포트/대화거리 조회)을 수행해야 한다.
  const MEANINGFUL_EVENT_NAMES = [
    'mission_start', 'freechat_start', 'play_start',
    'parent_report_view', 'parent_conversation_topic_view',
  ];
  const countActiveFamilies = (events: any[]) =>
    countDistinct(events, 'family_id', e => MEANINGFUL_EVENT_NAMES.includes(e.event_name));

  const getDualActiveFamilies = (events: any[]) => {
    const childSide = new Set();
    const parentSide = new Set();
    for (const e of events) {
      if (!e.family_id) continue;
      if (['mission_start', 'freechat_start', 'play_start'].includes(e.event_name)) {
        childSide.add(e.family_id);
      }
      if (['parent_report_view', 'parent_conversation_topic_view'].includes(e.event_name)) {
        parentSide.add(e.family_id);
      }
    }
    let intersection = 0;
    for (const fid of childSide) {
      if (parentSide.has(fid)) intersection++;
    }
    return intersection;
  };

  const makeKpi = (val: number, prev: number) => {
    let deltaPct: number | null = null;
    if (prev > 0) {
      deltaPct = Math.round(((val - prev) / prev) * 1000) / 10;
    }
    return { value: val, prevValue: prev, deltaPct };
  };

  const curSessStats = calcSessionStats(curSessions);
  const prevSessStats = calcSessionStats(prevSessions);

  const kpis = {
    totalFamilies: makeKpi(calcFamilies(toIso), calcFamilies(prevToIso)),
    activeFamilies: makeKpi(countActiveFamilies(curEvents), countActiveFamilies(prevEvents)),
    newFamilies: makeKpi(calcNewFamilies(fromIso, toIso), calcNewFamilies(prevFromIso, prevToIso)),
    visitingParents: makeKpi(
      countDistinct(curEvents, 'actor_id', e => e.event_name === 'parent_login'),
      countDistinct(prevEvents, 'actor_id', e => e.event_name === 'parent_login')
    ),
    activeParents: makeKpi(
      countDistinct(curEvents, 'actor_id', e => ['parent_report_view','parent_conversation_topic_view'].includes(e.event_name)),
      countDistinct(prevEvents, 'actor_id', e => ['parent_report_view','parent_conversation_topic_view'].includes(e.event_name))
    ),
    visitingChildren: makeKpi(
      countDistinct(curEvents, 'child_id', e => e.event_name === 'child_login'),
      countDistinct(prevEvents, 'child_id', e => e.event_name === 'child_login')
    ),
    activeChildren: makeKpi(
      countDistinct(curEvents, 'child_id', e => ['mission_start','freechat_start','play_start'].includes(e.event_name)),
      countDistinct(prevEvents, 'child_id', e => ['mission_start','freechat_start','play_start'].includes(e.event_name))
    ),
    totalVisits: makeKpi(
      countEvents(curEvents, e => ['parent_login','child_login'].includes(e.event_name)),
      countEvents(prevEvents, e => ['parent_login','child_login'].includes(e.event_name))
    ),
    totalSessions: makeKpi(curSessStats.total, prevSessStats.total),
    avgSessionDurationSec: makeKpi(curSessStats.avg, prevSessStats.avg),
    missionStarts: makeKpi(
      countEvents(curEvents, e => e.event_name === 'mission_start'),
      countEvents(prevEvents, e => e.event_name === 'mission_start')
    ),
    missionCompletes: makeKpi(
      countEvents(curEvents, e => e.event_name === 'mission_complete'),
      countEvents(prevEvents, e => e.event_name === 'mission_complete')
    ),
    freechatChildren: makeKpi(
      countDistinct(curEvents, 'child_id', e => e.event_name === 'freechat_start'),
      countDistinct(prevEvents, 'child_id', e => e.event_name === 'freechat_start')
    ),
    playChildren: makeKpi(
      countDistinct(curEvents, 'child_id', e => e.event_name === 'play_start'),
      countDistinct(prevEvents, 'child_id', e => e.event_name === 'play_start')
    ),
    reportViewingParents: makeKpi(
      countDistinct(curEvents, 'actor_id', e => e.event_name === 'parent_report_view'),
      countDistinct(prevEvents, 'actor_id', e => e.event_name === 'parent_report_view')
    ),
    dualActivationFamilies: makeKpi(getDualActiveFamilies(curEvents), getDualActiveFamilies(prevEvents))
  };

  // 5. Daily Trend
  const dailyTrend = [];
  const daysInPeriod = daysDiff + 1;
  for (let i = 0; i < daysInPeriod; i++) {
    const dStr = getOffsetDateStr(fromStr, i);
    const dIsoStart = dStr + "T00:00:00+09:00";
    const dIsoEnd = dStr + "T23:59:59.999+09:00";
    
    const dStartMs = toMs(dIsoStart);
    const dEndMs = toMs(dIsoEnd);
    const dEvents = curEvents.filter(e => toMs(e.occurred_at) >= dStartMs && toMs(e.occurred_at) <= dEndMs);
    const dSessions = curSessions.filter(s => toMs(s.started_at) >= dStartMs && toMs(s.started_at) <= dEndMs);
    
    dailyTrend.push({
      date: dStr,
      activeFamilies: countActiveFamilies(dEvents),
      activeParents: countDistinct(dEvents, 'actor_id', e => ['parent_report_view','parent_conversation_topic_view'].includes(e.event_name)),
      activeChildren: countDistinct(dEvents, 'child_id', e => ['mission_start','freechat_start','play_start'].includes(e.event_name)),
      totalSessions: dSessions.length,
      missionCompletes: countEvents(dEvents, e => e.event_name === 'mission_complete'),
      freechatUsers: countDistinct(dEvents, 'child_id', e => e.event_name === 'freechat_start'),
      playUsers: countDistinct(dEvents, 'child_id', e => e.event_name === 'play_start'),
      reportViews: countEvents(dEvents, e => e.event_name === 'parent_report_view')
    });
  }

  // 6. Today Activity (max 50)
  const todayIsoStart = todayStr + "T00:00:00+09:00";
  const todayIsoEnd = todayStr + "T23:59:59.999+09:00";
  
  const todayStartMs = toMs(todayIsoStart);
  const todayEndMs = toMs(todayIsoEnd);
  const todayEvents = curEvents
    .filter(e => toMs(e.occurred_at) >= todayStartMs && toMs(e.occurred_at) <= todayEndMs)
    .sort((a, b) => toMs(a.occurred_at) - toMs(b.occurred_at))
    .slice(0, 50);

  const anonMap = new Map<string, string>();
  let childIdx = 1;
  let parentIdx = 1;

  const getAlpha = (i: number) => {
    if (i <= 26) return String.fromCharCode(64 + i);
    return String.fromCharCode(64 + ((i-1)%26 + 1)) + Math.floor((i-1)/26);
  };

  const todayActivity = todayEvents.map(e => {
    let actorLabel = "알 수 없음";
    if (e.actor_type === 'child' && e.child_id) {
      if (!anonMap.has(e.child_id)) {
        anonMap.set(e.child_id, `아이 ${getAlpha(childIdx++)}`);
      }
      actorLabel = anonMap.get(e.child_id)!;
    } else if (e.actor_type === 'parent' && e.actor_id) {
      if (!anonMap.has(e.actor_id)) {
        anonMap.set(e.actor_id, `부모 ${getAlpha(parentIdx++)}`);
      }
      actorLabel = anonMap.get(e.actor_id)!;
    }

    return {
      occurredAt: e.occurred_at,
      actorType: e.actor_type,
      actorLabel,
      eventName: e.event_name,
      feature: e.feature || "unknown"
    };
  });

  return NextResponse.json({
    period: {
      key: periodParam,
      from: fromStr,
      to: toStr,
      prevFrom: prevFromStr,
      prevTo: prevToStr,
      timezone: "Asia/Seoul"
    },
    kpis,
    dailyTrend,
    todayActivity,
    meta: {
      testAccountsExcluded: !includeTestAccounts,
      testFamilyExclusionRule: "is_internal_test=true인 부모 또는 아이가 하나라도 있는 가족 전체(부모 활동 포함) 제외",
      generatedAt: new Date().toISOString()
    }
  });
}
