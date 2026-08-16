import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { isVacation, getKstHour } from "@/lib/mission/missionTimeGate";
import { sendMissionStartPushToChild, type MissionPushType } from "@/lib/mission/missionPushService";

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
  const { data: subscriptions, error } = await db.from("push_subscriptions").select("child_id").eq("role", "child").eq("is_active", true).eq("permission_status", "granted").not("child_id", "is", null);
  if (error) return NextResponse.json({ error: "Subscription lookup failed" }, { status: 500 });
  const childIds = [...new Set((subscriptions ?? []).map((row) => row.child_id as string))];
  if (!childIds.length) return NextResponse.json({ ok: true, sent: 0, targets: 0 });
  const [{ data: completed }, { data: inProgress }, { data: notified }, { data: preferences }] = await Promise.all([
    db.from("chat_sessions").select("child_id,mission_progress!inner(status)").in("child_id", childIds).eq("session_type", "mission").eq("mission_progress.business_date", businessDate).eq("mission_progress.status", "COMPLETED").gte("started_at", start).lte("started_at", end),
    // 오늘 미션을 시작했지만 아직 끝내지 않은 아이 — 시작 문구가 아니라 이어하기 문구를 보낸다(079 §7).
    db.from("chat_sessions").select("child_id,mission_progress!inner(status)").in("child_id", childIds).eq("session_type", "mission").eq("mission_progress.business_date", businessDate).eq("mission_progress.status", "IN_PROGRESS").gte("started_at", start).lte("started_at", end),
    db.from("mission_notification_logs").select("child_id,status").in("child_id", childIds).eq("business_date", businessDate).eq("round_type", roundType).eq("source", "cron"),
    db.from("notification_preferences").select("child_id,mission_start_enabled").in("child_id", childIds).eq("role", "child"),
  ]);
  const completedSet = new Set((completed ?? []).map((row) => row.child_id));
  const inProgressSet = new Set((inProgress ?? []).map((row) => row.child_id));
  const sentSet = new Set((notified ?? []).filter((row) => row.status === "sent").map((row) => row.child_id));
  const disabledSet = new Set((preferences ?? []).filter((row) => !row.mission_start_enabled).map((row) => row.child_id));
  const targets = childIds.filter((id) => !completedSet.has(id) && !sentSet.has(id) && !disabledSet.has(id));
  let sent = 0;
  let failed = 0;
  for (const childId of targets) {
    try {
      const result = await sendMissionStartPushToChild({
        childId,
        missionType: Number(missionType) as MissionPushType,
        source: "cron",
        progressState: inProgressSet.has(childId) ? "IN_PROGRESS" : "NOT_STARTED",
      });
      if (result.outcome === "sent" || result.outcome === "already_sent") sent += 1;
      else if (result.outcome !== "duplicate") failed += 1;
    } catch (sendError) {
      failed += 1;
      console.error("[cron/mission-start] child send failed", childId, sendError instanceof Error ? sendError.message : "unknown");
    }
  }
  return NextResponse.json({ ok: true, sent, failed, targets: targets.length });
}
