import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getTestFamilyIds } from "@/lib/admin/retentionFilter";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { toKSTDateStr, getOffsetDateStr } from "@/lib/analytics/kstDate";
import { computeChildActivityMetrics } from "@/lib/admin/retentionChildMetrics";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ childId: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { childId } = await params;
  const includeTestAccounts = req.nextUrl.searchParams.get("includeTestAccounts") === "true";
  const service = createServiceClient();

  const nowKST = new Date();
  nowKST.setHours(nowKST.getHours() + 9);
  const todayStr = nowKST.toISOString().slice(0, 10);
  const ms = (iso: string) => new Date(iso).getTime();

  // 1. Fetch child_profile
  const { data: childData, error: childError } = await service.from("child_profiles")
    .select("id, family_id, is_test_account, is_internal_test, grade")
    .eq("id", childId)
    .single();

  if (childError || !childData) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (!includeTestAccounts) {
    const testFamilyIds = await getTestFamilyIds(service);
    if (
      childData.is_test_account ||
      childData.is_internal_test ||
      (childData.family_id && testFamilyIds.has(childData.family_id))
    ) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
  }

  // 2. Check if family is test family
  if (!includeTestAccounts && childData.family_id) {
    const { data: siblingsData, error: siblingsError } = await service.from("child_profiles")
      .select("id, is_test_account")
      .eq("family_id", childData.family_id);

    if (siblingsError) {
      return NextResponse.json({ error: `child_profiles(형제) 조회 실패: ${siblingsError.message}` }, { status: 500 });
    }
    if (siblingsData?.some(c => c.is_test_account)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
  }

  // 3. child_login 타임라인(최근 방문·타임라인 표시용) — 활성 일수/미션 수 계산에는
  // 더 이상 쓰지 않는다(§ 아래 공통 함수가 mission_progress/behavior_events 기준으로
  // 별도 계산).
  const allEvents: any[] = [];
  let eOffset = 0;
  while (true) {
    const { data, error } = await service.from("behavior_events")
      .select("id, event_name, occurred_at, feature, play_type, conversation_mode")
      .eq("child_id", childId)
      .eq("is_test_account", false)
      .order("occurred_at", { ascending: false }).order("id", { ascending: false })
      .range(eOffset, eOffset + 999);

    if (error) return NextResponse.json({ error: `behavior_events 조회 실패: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    allEvents.push(...data);
    if (data.length < 1000) break;
    eOffset += 1000;
  }

  let lastVisitAt: string | null = null;
  const playByTypeAllTime: Record<string, number> = {};
  const timeline = [];
  for (let i = 0; i < allEvents.length; i++) {
    const e = allEvents[i];
    if (e.event_name === "child_login") {
      if (!lastVisitAt || ms(e.occurred_at) > ms(lastVisitAt)) lastVisitAt = e.occurred_at;
    }
    if (e.event_name === "play_start" && e.play_type) {
      playByTypeAllTime[e.play_type] = (playByTypeAllTime[e.play_type] || 0) + 1;
    }
    if (timeline.length < 200) {
      timeline.push({
        occurredAt: e.occurred_at,
        eventName: e.event_name,
        feature: e.feature || "unknown",
        playType: e.play_type || null,
        conversationMode: e.conversation_mode || null
      });
    }
  }

  // 4. 활성 일수·미션/자유대화/놀이 수 — children/route.ts(목록)와 완전히 동일한 공통
  // 함수로 계산해, 목록·상세 드릴다운·CSV 사이에 숫자가 어긋나지 않게 한다. "최근 7일"과
  // "최근 30일"을 각각 같은 기준(활성 일수도, 미션 수도 같은 기간 창)으로 짝지어 보여준다
  // — 예전엔 활성 일수만 7/30일로 나뉘고 미션 수는 기간 필터 자체가 없는 전체 누적이라
  // "활성 5일인데 미션 14회"처럼 서로 다른 분모를 비교하는 것처럼 보이는 근본 원인이었다.
  const prev7Str = getOffsetDateStr(todayStr, -6);
  const prev30Str = getOffsetDateStr(todayStr, -29);
  const [metrics7, metrics30, metricsAll] = await Promise.all([
    computeChildActivityMetrics(service, [childId], { fromStr: prev7Str, toStr: todayStr }),
    computeChildActivityMetrics(service, [childId], { fromStr: prev30Str, toStr: todayStr }),
    computeChildActivityMetrics(service, [childId], { fromStr: null, toStr: todayStr }),
  ]);
  const m7 = metrics7.get(childId) || { activeDaysTotal: 0, missionCount: 0, freechatCount: 0, playCount: 0, activeDates: [], missionByDate: {} };
  const m30 = metrics30.get(childId) || { activeDaysTotal: 0, missionCount: 0, freechatCount: 0, playCount: 0, activeDates: [], missionByDate: {} };
  const mAll = metricsAll.get(childId) || { activeDaysTotal: 0, missionCount: 0, freechatCount: 0, playCount: 0, activeDates: [], missionByDate: {} };

  // 감사용 검증: 미션 수는 항상 활성 일수 x 2 이하여야 한다(하루 MISSION_I 최대 1회 +
  // MISSION_II 최대 1회). 위반 시 조용히 넘기지 않고 응답에 명시적으로 남긴다.
  const integrityViolations: string[] = [];
  if (m7.missionCount > m7.activeDaysTotal * 2) integrityViolations.push(`last7: missionCount(${m7.missionCount}) > activeDaysTotal(${m7.activeDaysTotal})*2`);
  if (m30.missionCount > m30.activeDaysTotal * 2) integrityViolations.push(`last30: missionCount(${m30.missionCount}) > activeDaysTotal(${m30.activeDaysTotal})*2`);
  if (mAll.missionCount > mAll.activeDaysTotal * 2) integrityViolations.push(`all: missionCount(${mAll.missionCount}) > activeDaysTotal(${mAll.activeDaysTotal})*2`);

  const completionCount = allEvents.filter(e => e.event_name === "mission_complete").length;

  let streakDays = 0;
  let checkDate = todayStr;
  const allActiveDatesSet = new Set(mAll.activeDates);
  while (allActiveDatesSet.has(checkDate)) {
    streakDays++;
    checkDate = getOffsetDateStr(checkDate, -1);
  }

  return NextResponse.json({
    childId,
    familyId: childData.family_id,
    grade: childData.grade || "알 수 없음",
    firstMeaningfulUseAt: mAll.activeDates.length > 0 ? mAll.activeDates[0] : null,
    lastVisitAt,
    activeDaysLast7: m7.activeDaysTotal,
    activeDaysLast30: m30.activeDaysTotal,
    streakDays,
    totalVisits: allEvents.filter(e => e.event_name === "child_login").length,
    mission: {
      last7: m7.missionCount,
      last30: m30.missionCount,
      allTime: mAll.missionCount,
      completeCount: completionCount,
      completionRate: mAll.missionCount > 0 ? Number((completionCount / mAll.missionCount).toFixed(2)) : null,
      byDateLast30: m30.missionByDate,
    },
    freechat: { last7: m7.freechatCount, last30: m30.freechatCount, allTime: mAll.freechatCount },
    play: { last7: m7.playCount, last30: m30.playCount, allTime: mAll.playCount, byType: playByTypeAllTime },
    integrityViolations,
    timeline
  });
}
