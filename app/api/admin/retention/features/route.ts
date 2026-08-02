import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getTestFamilyIds } from "@/lib/admin/retentionFilter";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { getOffsetDateStr } from "@/lib/analytics/kstDate";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const includeTestAccounts = req.nextUrl.searchParams.get("includeTestAccounts") === "true";
  const service = createServiceClient();

  // Test accounts exclusion
  const testFamilyIds = !includeTestAccounts ? await getTestFamilyIds(service) : new Set<string>();

  // Fetch all behavior_events
  let allEvents: any[] = [];
  let eOffset = 0;
  while (true) {
    let q = service.from("behavior_events")
      .select("event_name, actor_type, actor_id, child_id, family_id, session_id, feature, conversation_mode, play_type, occurred_at")
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

  // Helpers
  const toMs = (iso: string) => new Date(iso).getTime();
  const getKstDateStr = (iso: string) => {
    const d = new Date(iso);
    d.setHours(d.getHours() + 9);
    return d.toISOString().slice(0, 10);
  };
  
  const nowKST = new Date();
  nowKST.setHours(nowKST.getHours() + 9);
  const todayStr = nowKST.toISOString().slice(0, 10);
  
  const last7dDates: string[] = [];
  for (let i = 6; i >= 0; i--) {
    last7dDates.push(getOffsetDateStr(todayStr, -i));
  }
  
  // 1. Features Stats
  const featureList: Array<"mission" | "freechat" | "play" | "daily_report" | "conversation_topic"> = [
    "mission", "freechat", "play", "daily_report", "conversation_topic"
  ];
  
  const featuresRes = featureList.map(f => {
    const fEvents = allEvents.filter(e => e.feature === f || e.event_name.includes(f));
    
    // start vs complete events
    let startEventNames = [`${f}_start`];
    let completeEventName = `${f}_complete`;
    let userKey = f === "daily_report" || f === "conversation_topic" ? "actor_id" : "child_id";
    
    if (f === "daily_report") {
      startEventNames = ["parent_report_view"];
    } else if (f === "conversation_topic") {
      startEventNames = ["parent_conversation_topic_view"];
    }
    
    const startEvents = fEvents.filter(e => startEventNames.includes(e.event_name));
    const completeEvents = fEvents.filter(e => e.event_name === completeEventName);
    
    // distinct users
    const startUsers = new Set(startEvents.map(e => e[userKey]).filter(Boolean));
    const userCount = startUsers.size;
    const startCount = startEvents.length;
    const completeCount = completeEvents.length;
    
    const completionRate = startCount > 0 && f !== "daily_report" && f !== "conversation_topic" 
      ? Math.round((completeCount / startCount) * 1000) / 10 
      : null;
      
    // reuseUserCount (>= 2 KST dates)
    const userDates = new Map<string, Set<string>>();
    for (const e of startEvents) {
      const u = e[userKey];
      if (u) {
        if (!userDates.has(u)) userDates.set(u, new Set());
        userDates.get(u)!.add(getKstDateStr(e.occurred_at));
      }
    }
    
    let reuseUserCount = 0;
    for (const dates of Array.from(userDates.values())) {
      if (dates.size >= 2) reuseUserCount++;
    }
    
    // last7dTrend
    const trend = last7dDates.map(dateStr => {
      return startEvents.filter(e => getKstDateStr(e.occurred_at) === dateStr).length;
    });
    
    return {
      feature: f,
      userCount,
      startCount,
      completeCount,
      completionRate,
      reuseUserCount,
      last7dTrend: trend
    };
  });
  
  // 2. Conversation Modes
  const modeList: Array<"A"|"B"|"C"|"D"|"E"|"F"> = ["A", "B", "C", "D", "E", "F"];
  const missionStartEvents = allEvents.filter(e => e.event_name === "mission_start" && e.conversation_mode);
  const missionCompleteEvents = allEvents.filter(e => e.event_name === "mission_complete" && e.session_id);
  
  const completeSessionIds = new Set(missionCompleteEvents.map(e => e.session_id));
  
  const conversationModesRes = modeList.map(m => {
    const mStarts = missionStartEvents.filter(e => e.conversation_mode === m);
    const childCount = new Set(mStarts.map(e => e.child_id).filter(Boolean)).size;
    const startCount = mStarts.length;
    
    // match by session_id
    let completeCount = 0;
    for (const s of mStarts) {
      if (s.session_id && completeSessionIds.has(s.session_id)) {
        completeCount++;
      }
    }
    
    const completionRate = startCount > 0 ? Math.round((completeCount / startCount) * 1000) / 10 : null;
    
    return {
      mode: m,
      childCount,
      startCount,
      completeCount,
      completionRate
    };
  });
  
  // 3. Play Types
  const pTypeList: Array<"comic_book"|"quiz"|"hairstyle"|"mbti"> = ["comic_book", "quiz", "hairstyle", "mbti"];
  const playStartEvents = allEvents.filter(e => e.event_name === "play_start" && e.play_type);
  const playCompleteEvents = allEvents.filter(e => e.event_name === "play_complete" && e.play_type);
  
  const playTypesRes = pTypeList.map(p => {
    const pStarts = playStartEvents.filter(e => e.play_type === p);
    const pCompletes = playCompleteEvents.filter(e => e.play_type === p);
    
    const startChildCount = new Set(pStarts.map(e => e.child_id).filter(Boolean)).size;
    const completeChildCount = new Set(pCompletes.map(e => e.child_id).filter(Boolean)).size;
    
    const startCount = pStarts.length;
    const completeCount = pCompletes.length;
    const completionRate = startCount > 0 ? Math.round((completeCount / startCount) * 1000) / 10 : null;
    
    const userDates = new Map<string, Set<string>>();
    for (const e of pStarts) {
      const u = e.child_id;
      if (u) {
        if (!userDates.has(u)) userDates.set(u, new Set());
        userDates.get(u)!.add(getKstDateStr(e.occurred_at));
      }
    }
    
    let reuseChildCount = 0;
    for (const dates of Array.from(userDates.values())) {
      if (dates.size >= 2) reuseChildCount++;
    }
    
    return {
      playType: p,
      startChildCount,
      completeChildCount,
      completionRate,
      reuseChildCount
    };
  });

  return NextResponse.json({
    features: featuresRes,
    conversationModes: conversationModesRes,
    playTypes: playTypesRes,
    meta: {
      testAccountsExcluded: !includeTestAccounts,
      timezone: "Asia/Seoul",
      generatedAt: new Date().toISOString()
    }
  });
}
