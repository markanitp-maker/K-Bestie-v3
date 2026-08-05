import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendPushNotification } from "@/lib/notifications/push";
import { isVacation, getKstHour } from "@/lib/mission/missionTimeGate";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const missionType = url.searchParams.get("missionType"); // "1" or "2"
  const testChildId = url.searchParams.get("testChildId"); // for Dev QA
  
  // Verify Cron execution if it's not a test
  if (!testChildId) {
    const authHeader = req.headers.get("Authorization");
    const configuredSecrets = [process.env.CRON_SECRET, process.env.BATCH_SECRET].filter(
      (s): s is string => !!s
    );
    const authorized = configuredSecrets.length > 0 && configuredSecrets.some((s) => authHeader === `Bearer ${s}`);
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    // If it's a manual test, require admin privileges
    const { requireAdmin } = await import("@/lib/admin/requireAdmin");
    const denied = await requireAdmin();
    if (denied) return denied;
  }

  // Time & Vacation Check (only if not a test)
  if (!testChildId) {
    const hour = getKstHour();
    
    if (missionType === "1") {
      const isVac = isVacation();
      if (isVac && hour !== 10) return NextResponse.json({ skipped: true, reason: "Vacation but not 10:00 KST" });
      if (!isVac && hour !== 13) return NextResponse.json({ skipped: true, reason: "Semester but not 13:00 KST" });
    } else if (missionType === "2") {
      if (hour !== 18) return NextResponse.json({ skipped: true, reason: "Not 18:00 KST" });
    } else {
      return NextResponse.json({ error: "Invalid missionType" }, { status: 400 });
    }
  }

  const supabase = createServiceClient();
  
  // 1. Get Push Subscriptions for children
  const { data: subs, error: subsError } = await supabase
    .from("push_subscriptions")
    .select("user_id, endpoint, p256dh, auth");
    
  if (subsError || !subs) {
    return NextResponse.json({ error: "Failed to fetch subscriptions" }, { status: 500 });
  }

  // 2. Map user_id to child_id
  const { data: members } = await supabase
    .from("family_members")
    .select("id, user_id")
    .eq("role", "child")
    .in("user_id", subs.map(s => s.user_id));

  if (!members || members.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, msg: "No child subscriptions" });
  }

  const { data: profiles } = await supabase
    .from("child_profiles")
    .select("id, member_id")
    .in("member_id", members.map(m => m.id));

  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, msg: "No child profiles" });
  }

  // Build a map of childId -> subscription
  const childIdToSub = new Map<string, any[]>();
  const memberIdToUserId = new Map<string, string>();
  members.forEach(m => memberIdToUserId.set(m.id, m.user_id));
  
  const userIdToSub = new Map<string, any[]>();
  subs.forEach(s => {
    if (!userIdToSub.has(s.user_id)) userIdToSub.set(s.user_id, []);
    userIdToSub.get(s.user_id)!.push(s);
  });

  profiles.forEach(p => {
    const uid = memberIdToUserId.get(p.member_id);
    if (uid && userIdToSub.has(uid)) {
      childIdToSub.set(p.id, userIdToSub.get(uid) || []);
    }
  });

  let targetChildIds = Array.from(childIdToSub.keys());

  // Filter by testChildId if provided
  if (testChildId) {
    targetChildIds = targetChildIds.filter(id => id === testChildId);
  }

  // 3. Filter out those who already completed the mission today
  const kstOffset = 9 * 60 * 60 * 1000;
  const nowKst = new Date(new Date().getTime() + kstOffset);
  const yyyy = nowKst.getUTCFullYear();
  const mm = String(nowKst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(nowKst.getUTCDate()).padStart(2, '0');
  const businessDate = `${yyyy}-${mm}-${dd}`;
  const startOfDayKst = new Date(`${businessDate}T00:00:00+09:00`).toISOString();
  const endOfDayKst = new Date(`${businessDate}T23:59:59.999+09:00`).toISOString();
  
  const activeRound = missionType === "1" ? "round1_day" : "round2_night";

  const { data: completedSessions } = await supabase
    .from("chat_sessions")
    .select("child_id, mission_progress!inner(status, round_type)")
    .eq("session_type", "mission")
    .eq("mission_progress.round_type", activeRound)
    .gte("started_at", startOfDayKst)
    .lte("started_at", endOfDayKst)
    .eq("mission_progress.status", "COMPLETED");

  const completedSet = new Set(completedSessions?.map(s => s.child_id) || []);

  // 중복 발송 방지: 오늘·이 회차에 이미 발송 로그가 있는 아이는 제외한다.
  const { data: alreadyNotified } = await supabase
    .from("mission_notification_logs")
    .select("child_id")
    .eq("business_date", businessDate)
    .eq("round_type", activeRound);
  const alreadyNotifiedSet = new Set(alreadyNotified?.map((r) => r.child_id) || []);

  const finalTargets = targetChildIds.filter(id => !completedSet.has(id) && !alreadyNotifiedSet.has(id));

  // 4. Send Notifications
  const payload = {
    title: missionType === "1" ? "🌞 미션 시작 시간이에요!" : "🌙 저녁 미션 시작 시간이에요!",
    body: missionType === "1" ? "케이와 함께 오늘의 첫 번째 미션을 시작해볼까요?" : "오늘 하루를 마무리하는 미션을 케이와 함께 해요!",
    url: "/child/missions",
  };

  let sentCount = 0;
  for (const childId of finalTargets) {
    const userSubs = childIdToSub.get(childId);
    if (!userSubs) continue;

    // De-duplicate endpoints for the same child
    const endpoints = new Set();
    for (const sub of userSubs) {
      if (endpoints.has(sub.endpoint)) continue;
      endpoints.add(sub.endpoint);
      try {
        await sendPushNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        sentCount++;
      } catch (err) {
        console.error(`[cron/mission-start] Failed to send push to child ${childId}:`, err);
      }
    }

    // 테스트 발송(testChildId)은 실제 하루 발송 이력에 남기지 않는다 — QA가 정식 발송을 막지 않게 한다.
    // 실패한 개별 구독이 있어도 로그는 남겨 재시도 폭주로 인한 중복 알림을 막는다.
    if (!testChildId) {
      await supabase.from("mission_notification_logs").upsert(
        { child_id: childId, business_date: businessDate, round_type: activeRound },
        { onConflict: "child_id,business_date,round_type" }
      );
    }
  }

  return NextResponse.json({ ok: true, sent: sentCount, targets: finalTargets.length });
}
