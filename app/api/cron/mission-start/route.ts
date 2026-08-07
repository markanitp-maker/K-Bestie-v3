import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPushErrorStatus, sendPushNotificationWithRetry } from "@/lib/notifications/push";
import { isVacation, getKstHour } from "@/lib/mission/missionTimeGate";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const missionType = req.nextUrl.searchParams.get("missionType");
  const configuredSecrets = [process.env.CRON_SECRET, process.env.BATCH_SECRET].filter(Boolean);
  if (!configuredSecrets.some((secret) => req.headers.get("authorization") === `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (missionType !== "1" && missionType !== "2") return NextResponse.json({ error: "Invalid missionType" }, { status: 400 });
  const hour = getKstHour();
  if (missionType === "1" && hour !== (isVacation() ? 10 : 13)) return NextResponse.json({ skipped: true, reason: "Outside mission window" });
  if (missionType === "2" && hour !== 18) return NextResponse.json({ skipped: true, reason: "Outside mission window" });

  const db = createServiceClient();
  const businessDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const roundType = missionType === "1" ? "round1_day" : "round2_night";
  const start = new Date(`${businessDate}T00:00:00+09:00`).toISOString();
  const end = new Date(`${businessDate}T23:59:59.999+09:00`).toISOString();
  const { data: subscriptions, error } = await db.from("push_subscriptions").select("id,user_id,child_id,endpoint,p256dh,auth").eq("role", "child").eq("is_active", true).eq("permission_status", "granted").not("child_id", "is", null);
  if (error) return NextResponse.json({ error: "Subscription lookup failed" }, { status: 500 });
  const childIds = [...new Set((subscriptions ?? []).map((row) => row.child_id as string))];
  if (!childIds.length) return NextResponse.json({ ok: true, sent: 0, targets: 0 });
  const [{ data: completed }, { data: notified }, { data: preferences }] = await Promise.all([
    db.from("chat_sessions").select("child_id,mission_progress!inner(status,round_type)").in("child_id", childIds).eq("session_type", "mission").eq("mission_progress.round_type", roundType).eq("mission_progress.status", "COMPLETED").gte("started_at", start).lte("started_at", end),
    db.from("mission_notification_logs").select("child_id,status,attempt_count").in("child_id", childIds).eq("business_date", businessDate).eq("round_type", roundType),
    db.from("notification_preferences").select("child_id,mission_start_enabled").in("child_id", childIds).eq("role", "child"),
  ]);
  const completedSet = new Set((completed ?? []).map((row) => row.child_id));
  const sentSet = new Set((notified ?? []).filter((row) => row.status === "sent").map((row) => row.child_id));
  const disabledSet = new Set((preferences ?? []).filter((row) => !row.mission_start_enabled).map((row) => row.child_id));
  const attempts = new Map((notified ?? []).map((row) => [row.child_id, row.attempt_count]));
  const targets = childIds.filter((id) => !completedSet.has(id) && !sentSet.has(id) && !disabledSet.has(id));
  let sent = 0;
  for (const childId of targets) {
    await db.from("mission_notification_logs").upsert({ child_id: childId, business_date: businessDate, round_type: roundType, status: "pending", attempt_count: (attempts.get(childId) ?? 0) + 1, last_error_code: null, updated_at: new Date().toISOString() }, { onConflict: "child_id,business_date,round_type" });
    let successful = 0;
    let lastError = "NO_ACTIVE_SUBSCRIPTION";
    for (const subscription of (subscriptions ?? []).filter((row) => row.child_id === childId)) {
      try {
        await sendPushNotificationWithRetry({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, { title: missionType === "1" ? "미션 시작 시간이야!" : "저녁 미션 시작 시간이야!", body: "케이와 함께 오늘의 미션을 시작해 볼까요?", url: "/child/missions" });
        successful++;
      } catch (pushError) {
        const status = getPushErrorStatus(pushError);
        lastError = status ? `PUSH_${status}` : "PUSH_FAILED";
        if (status === 404 || status === 410) await db.from("push_subscriptions").update({ is_active: false, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", subscription.id);
      }
    }
    await db.from("mission_notification_logs").update({ status: successful ? "sent" : "failed", last_error_code: successful ? null : lastError, sent_at: successful ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("child_id", childId).eq("business_date", businessDate).eq("round_type", roundType);
    if (successful) sent++;
  }
  return NextResponse.json({ ok: true, sent, targets: targets.length });
}
