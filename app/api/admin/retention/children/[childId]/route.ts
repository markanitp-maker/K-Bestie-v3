import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getTestFamilyIds } from "@/lib/admin/retentionFilter";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { toKSTDateStr, getOffsetDateStr } from "@/lib/analytics/kstDate";

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
  const todayMs = new Date(todayStr + "T00:00:00Z").getTime();
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

  // 3. Fetch behavior_events for this child
  // 주의: 로그인 이벤트(child_login)의 actor_id는 아이의 auth user id이고, 미션/자유대화/
  // 놀이 이벤트는 child_profiles.id를 child_id 컬럼에 담는다(actor_id에는 안 담김) — 반드시
  // child_id 컬럼으로 조회해야 한다(actor_id로 조회하면 이 아이의 활동이 전부 누락된다).
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

  const loginDates = new Set<string>();
  let lastVisitAt: string | null = null;
  let firstMeaningfulUseAt: string | null = null;
  
  const mission = { startCount: 0, completeCount: 0, completionRate: null as number | null };
  const freechat = { startCount: 0, completeCount: 0 };
  const play = { startCount: 0, completeCount: 0, byType: { comic_book: 0, quiz: 0, hairstyle: 0, mbti: 0 } as Record<string, number> };

  const timeline = [];
  
  // Events are ordered desc (newest first)
  for (let i = 0; i < allEvents.length; i++) {
    const e = allEvents[i];
    const kstDate = toKSTDateStr(e.occurred_at);

    if (e.event_name === "child_login") {
      loginDates.add(kstDate);
      if (!lastVisitAt || ms(e.occurred_at) > ms(lastVisitAt)) {
        lastVisitAt = e.occurred_at;
      }
    } else if (e.event_name === "mission_start") {
      mission.startCount++;
      firstMeaningfulUseAt = e.occurred_at; // will be overwritten since reverse order, so ends up as oldest
    } else if (e.event_name === "mission_complete") {
      mission.completeCount++;
    } else if (e.event_name === "freechat_start") {
      freechat.startCount++;
      firstMeaningfulUseAt = e.occurred_at;
    } else if (e.event_name === "freechat_complete") {
      freechat.completeCount++;
    } else if (e.event_name === "play_start") {
      play.startCount++;
      firstMeaningfulUseAt = e.occurred_at;
      if (e.play_type && play.byType[e.play_type] !== undefined) {
        play.byType[e.play_type]++;
      } else if (e.play_type) {
        play.byType[e.play_type] = 1;
      }
    } else if (e.event_name === "play_complete") {
      play.completeCount++;
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

  // To get the true firstMeaningfulUseAt (earliest), we need to search ascending or keep track.
  // Since we processed newest to oldest, `firstMeaningfulUseAt` currently holds the oldest one we saw.
  // We can double check by finding the min occurred_at among meaningful events.
  const meaningfulEvents = allEvents.filter(e => ["mission_start", "freechat_start", "play_start"].includes(e.event_name));
  if (meaningfulEvents.length > 0) {
    // The last one in the array is the oldest (since array is desc)
    firstMeaningfulUseAt = meaningfulEvents[meaningfulEvents.length - 1].occurred_at;
  } else {
    firstMeaningfulUseAt = null;
  }

  const prev7Str = getOffsetDateStr(todayStr, -6);
  const prev30Str = getOffsetDateStr(todayStr, -29);
  const prev7Ms = ms(prev7Str);
  const prev30Ms = ms(prev30Str);

  let activeDaysLast7 = 0;
  let activeDaysLast30 = 0;

  for (const dateStr of loginDates) {
    const dMs = ms(dateStr);
    if (dMs >= prev7Ms && dMs <= todayMs) activeDaysLast7++;
    if (dMs >= prev30Ms && dMs <= todayMs) activeDaysLast30++;
  }

  if (mission.startCount > 0) {
    mission.completionRate = Number((mission.completeCount / mission.startCount).toFixed(2));
  }

  let streakDays = 0;
  let checkDate = todayStr;
  while (loginDates.has(checkDate)) {
    streakDays++;
    checkDate = getOffsetDateStr(checkDate, -1);
  }

  return NextResponse.json({
    childId,
    familyId: childData.family_id,
    grade: childData.grade || "알 수 없음",
    firstMeaningfulUseAt,
    lastVisitAt,
    activeDaysLast7,
    activeDaysLast30,
    streakDays,
    totalVisits: allEvents.filter(e => e.event_name === "child_login").length,
    mission,
    freechat,
    play,
    timeline
  });
}
