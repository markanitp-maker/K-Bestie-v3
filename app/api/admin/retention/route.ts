import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

function toKSTDateStr(iso: string) {
  const d = new Date(iso);
  d.setHours(d.getHours() + 9);
  return d.toISOString().slice(0, 10);
}

function getOffsetDateStr(dateStr: string, offsetDays: number) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// id를 chunkSize 단위로 나눠 조회하되, 각 chunk 결과가 pageSize(=Postgrest 기본 최대 반환
// 행 수)에 도달하면 더 있을 수 있다고 보고 range()로 다음 페이지까지 이어 붙인다 — 그렇지
// 않으면 한 chunk의 메시지 수가 많을 때(200세션 × 다수 메시지) 조용히 잘려서 턴수가
// 과소집계될 수 있다. 쿼리 에러는 삼키지 않고 던져서 상위에서 500으로 처리하게 한다.
async function fetchInChunks<T>(
  queryFn: (chunk: string[], rangeFrom: number, rangeTo: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  ids: string[],
  chunkSize = 200,
  pageSize = 1000
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    let offset = 0;
    while (true) {
      const { data, error } = await queryFn(chunk, offset, offset + pageSize - 1);
      if (error) throw new Error(`fetchInChunks: ${error.message}`);
      const rows = data ?? [];
      results.push(...rows);
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
  }
  return results;
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const periodParam = req.nextUrl.searchParams.get("period");
  const period = periodParam === "month" || periodParam === "today" ? periodParam : "7d";
  
  const now = new Date();
  const to = new Date(now);
  const from = new Date(now);
  if (period === "today") {
    from.setHours(0, 0, 0, 0);
  } else if (period === "7d") {
    from.setDate(from.getDate() - 7);
  } else {
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
  }

  const fetchFrom = new Date(from);
  fetchFrom.setDate(fetchFrom.getDate() - 30); // For D30 retention calculation

  const service = createServiceClient();

  const includeTestAccounts = req.nextUrl.searchParams.get("includeTestAccounts") === "true";

  // 1. Fetch valid children (exclude test accounts)
  const { data: childProfiles, error: childErr } = await service
    .from("child_profiles")
    .select("id, name, is_internal_test, family_id");
  if (childErr) {
    return NextResponse.json({ error: `child_profiles 조회 실패: ${childErr.message}` }, { status: 500 });
  }

  const testFamilyIds = !includeTestAccounts ? await import("@/lib/admin/retentionFilter").then(m => m.getTestFamilyIds(service)) : new Set<string>();

  const validChildrenMap = new Map();
  for (const c of (childProfiles || [])) {
    if (includeTestAccounts) {
      validChildrenMap.set(c.id, c.name);
    } else {
      if (!c.is_internal_test && (!c.family_id || !testFamilyIds.has(c.family_id))) {
        validChildrenMap.set(c.id, c.name);
      }
    }
  }

  // 2. Fetch sessions in range [from - 7d, to] — 소프트 삭제(deleted_at 존재)된 세션은 제외.
  const { data: sessionsData, error: sessionsErr } = await service
    .from("chat_sessions")
    .select("id, child_id, session_type, started_at, ended_at, demo_mode")
    .is("deleted_at", null)
    .gte("started_at", fetchFrom.toISOString())
    .lte("started_at", to.toISOString());
  if (sessionsErr) {
    return NextResponse.json({ error: `chat_sessions 조회 실패: ${sessionsErr.message}` }, { status: 500 });
  }

  // Filter out demo_mode and invalid children
  const allValidSessions = (sessionsData || []).filter(
    s => s.demo_mode !== true && s.child_id && validChildrenMap.has(s.child_id)
  );

  // Separate into "current period sessions" and "past sessions"
  const currentSessions = allValidSessions.filter(s => new Date(s.started_at) >= from);
  const currentSessionIds = currentSessions.map(s => s.id);

  let missionsData: { session_id: string; status: string }[];
  let messagesData: { session_id: string }[];
  try {
    // 3. Fetch mission_progress for current sessions
    missionsData = await fetchInChunks(
      async (chunk, rf, rt) =>
        service.from("mission_progress").select("session_id, status").in("session_id", chunk).range(rf, rt),
      currentSessionIds
    );

    // 4. Fetch chat_messages for current sessions (for turn count)
    messagesData = await fetchInChunks(
      async (chunk, rf, rt) =>
        service.from("chat_messages").select("session_id").in("session_id", chunk).range(rf, rt),
      currentSessionIds
    );
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }

  // --- Calculate Metrics ---

  // 1. 일별 접속 아이 수 (activeChildren)
  const activeChildrenSet = new Set(currentSessions.map(s => s.child_id));
  const activeChildren = activeChildrenSet.size;

  // 2. 연속 접속 일수 / 재방문 (D1, D7)
  const activeDaysByChild = new Map<string, Set<string>>();
  for (const s of allValidSessions) {
    const dateStr = toKSTDateStr(s.started_at);
    if (!activeDaysByChild.has(s.child_id)) {
      activeDaysByChild.set(s.child_id, new Set());
    }
    activeDaysByChild.get(s.child_id)!.add(dateStr);
  }

  const periodDates: string[] = [];
  let dCur = new Date(from);
  dCur.setHours(dCur.getHours() + 9);
  const dEnd = new Date(to);
  dEnd.setHours(dEnd.getHours() + 9);
  while (dCur.toISOString().slice(0, 10) <= dEnd.toISOString().slice(0, 10)) {
    periodDates.push(dCur.toISOString().slice(0, 10));
    dCur.setDate(dCur.getDate() + 1);
  }

  let possibleD1 = 0, retainedD1 = 0;
  let possibleD3 = 0, retainedD3 = 0;
  let possibleD7 = 0, retainedD7 = 0;
  let possibleD14 = 0, retainedD14 = 0;
  let possibleD30 = 0, retainedD30 = 0;

  for (const dStr of periodDates) {
    const prev1Str = getOffsetDateStr(dStr, -1);
    const prev3Str = getOffsetDateStr(dStr, -3);
    const prev7Str = getOffsetDateStr(dStr, -7);
    const prev14Str = getOffsetDateStr(dStr, -14);
    const prev30Str = getOffsetDateStr(dStr, -30);

    for (const days of activeDaysByChild.values()) {
      if (days.has(prev1Str)) {
        possibleD1++;
        if (days.has(dStr)) retainedD1++;
      }
      if (days.has(prev3Str)) {
        possibleD3++;
        if (days.has(dStr)) retainedD3++;
      }
      if (days.has(prev7Str)) {
        possibleD7++;
        if (days.has(dStr)) retainedD7++;
      }
      if (days.has(prev14Str)) {
        possibleD14++;
        if (days.has(dStr)) retainedD14++;
      }
      if (days.has(prev30Str)) {
        possibleD30++;
        if (days.has(dStr)) retainedD30++;
      }
    }
  }

  const d1RetentionRate = possibleD1 > 0 ? retainedD1 / possibleD1 : 0;
  const d3RetentionRate = possibleD3 > 0 ? retainedD3 / possibleD3 : 0;
  const d7RetentionRate = possibleD7 > 0 ? retainedD7 / possibleD7 : 0;
  const d14RetentionRate = possibleD14 > 0 ? retainedD14 / possibleD14 : 0;
  const d30RetentionRate = possibleD30 > 0 ? retainedD30 / possibleD30 : 0;

  // 3. 미션 완료율
  const currentMissionSessions = currentSessions.filter(s => s.session_type === "mission");
  let completedMissions = 0;
  for (const m of missionsData) {
    if (m.status === "COMPLETED") completedMissions++;
  }
  const missionCompletionRate = currentMissionSessions.length > 0
    ? completedMissions / currentMissionSessions.length
    : 0;

  // 4. 평균 체류시간
  let totalDurationSec = 0;
  let durationCount = 0;
  for (const s of currentSessions) {
    if (s.started_at && s.ended_at) {
      const start = new Date(s.started_at).getTime();
      const end = new Date(s.ended_at).getTime();
      const sec = (end - start) / 1000;
      if (sec > 0 && sec < 86400) {
        totalDurationSec += sec;
        durationCount++;
      }
    }
  }
  const avgSessionDurationSec = durationCount > 0 ? totalDurationSec / durationCount : 0;

  // 5. 대화 턴 수
  const turnsBySession = new Map<string, number>();
  for (const m of messagesData) {
    turnsBySession.set(m.session_id, (turnsBySession.get(m.session_id) || 0) + 1);
  }
  let totalTurns = 0;
  for (const sessionId of currentSessionIds) {
    totalTurns += turnsBySession.get(sessionId) || 0;
  }
  const avgTurnsPerSession = currentSessionIds.length > 0 ? totalTurns / currentSessionIds.length : 0;

  // 6. 하루 2회 목표 달성률 & 아이별 상세
  const childDailyMap = new Map<string, { sessions: number; missionSessions: number }>();
  for (const s of currentSessions) {
    const dStr = toKSTDateStr(s.started_at);
    const key = `${s.child_id}::${dStr}`;
    if (!childDailyMap.has(key)) {
      childDailyMap.set(key, { sessions: 0, missionSessions: 0 });
    }
    const data = childDailyMap.get(key)!;
    data.sessions++;
    if (s.session_type === "mission") {
      data.missionSessions++;
    }
  }

  let totalGoalAchieved = 0;
  for (const data of childDailyMap.values()) {
    const achieved = Math.min(data.missionSessions, 2) / 2;
    totalGoalAchieved += achieved;
  }
  const dailyGoalAchievementRate = childDailyMap.size > 0 ? totalGoalAchieved / childDailyMap.size : 0;

  // 7. perChildDaily (아이별 요약)
  const todayStr = toKSTDateStr(new Date().toISOString());
  const perChildDaily = [];
  for (const [childId, name] of validChildrenMap.entries()) {
    const days = activeDaysByChild.get(childId) || new Set();
    if (days.size === 0) continue;

    let consecutiveDays = 0;
    let d = todayStr;
    if (!days.has(d)) {
      d = getOffsetDateStr(d, -1);
    }
    while (days.has(d)) {
      consecutiveDays++;
      d = getOffsetDateStr(d, -1);
    }

    let totalChildSessions = 0;
    const childPeriodDates = new Set<string>();
    for (const s of currentSessions) {
      if (s.child_id === childId) {
        totalChildSessions++;
        childPeriodDates.add(toKSTDateStr(s.started_at));
      }
    }
    
    if (totalChildSessions > 0) {
      perChildDaily.push({
        childId,
        name,
        avgSessionsPerActiveDay: Number((totalChildSessions / childPeriodDates.size).toFixed(1)),
        totalSessionsInPeriod: totalChildSessions,
        consecutiveDays
      });
    }
  }

  // Sort by consecutive days (desc) then total sessions (desc)
  perChildDaily.sort((a, b) => b.consecutiveDays - a.consecutiveDays || b.totalSessionsInPeriod - a.totalSessionsInPeriod);

  return NextResponse.json({
    period,
    activeChildren,
    missionCompletionRate,
    avgSessionDurationSec,
    avgTurnsPerSession,
    dailyGoalAchievementRate,
    d1RetentionRate,
    d3RetentionRate,
    d7RetentionRate,
    d14RetentionRate,
    d30RetentionRate,
    perChildDaily,
  });
}
