import { createServiceClient } from "@/lib/supabase/server";
import { getPushErrorStatus, sendPushNotificationWithRetry } from "@/lib/notifications/push";

export type MissionPushType = 1 | 2;
export type MissionPushSource = "cron" | "admin_test";

export type MissionPushResult = {
  outcome: "sent" | "failed" | "no_subscription" | "duplicate" | "already_sent";
  childId: string;
  missionType: MissionPushType;
  roundType: "round1_day" | "round2_night";
  successfulSubscriptions: number;
  failedSubscriptions: number;
  errorCode: string | null;
};

export function missionPushTemplate(missionType: MissionPushType) {
  return {
    roundType: missionType === 1 ? "round1_day" as const : "round2_night" as const,
    title: missionType === 1 ? "미션 시작 시간이야!" : "저녁 미션 시작 시간이야!",
    body: "케이와 함께 오늘의 미션을 시작해 볼까요?",
    url: "/child/missions",
  };
}

export function isRecentAdminTest(updatedAt: string, now = Date.now(), cooldownMs = 30_000) {
  const timestamp = new Date(updatedAt).getTime();
  return Number.isFinite(timestamp) && now - timestamp < cooldownMs;
}

function kstBusinessDate() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function sendMissionStartPushToChild({
  childId,
  missionType,
  source,
}: {
  childId: string;
  missionType: MissionPushType;
  source: MissionPushSource;
}): Promise<MissionPushResult> {
  const db = createServiceClient();
  const template = missionPushTemplate(missionType);
  const businessDate = kstBusinessDate();
  const nowIso = new Date().toISOString();

  const { data: child, error: childError } = await db.from("child_profiles").select("id").eq("id", childId).maybeSingle();
  if (childError) throw new Error("CHILD_LOOKUP_FAILED");
  if (!child) throw new Error("CHILD_NOT_FOUND");

  const { data: existing, error: existingError } = await db
    .from("mission_notification_logs")
    .select("id,status,attempt_count,updated_at")
    .eq("child_id", childId)
    .eq("business_date", businessDate)
    .eq("round_type", template.roundType)
    .eq("source", source)
    .maybeSingle();
  if (existingError) throw new Error("MISSION_PUSH_LOG_LOOKUP_FAILED");

  if (existing) {
    if (source === "cron" && existing.status === "sent") {
      return { outcome: "already_sent", childId, missionType, roundType: template.roundType, successfulSubscriptions: 0, failedSubscriptions: 0, errorCode: null };
    }
    if (source === "admin_test" && isRecentAdminTest(existing.updated_at)) {
      return { outcome: "duplicate", childId, missionType, roundType: template.roundType, successfulSubscriptions: 0, failedSubscriptions: 0, errorCode: "DUPLICATE_REQUEST" };
    }
    const { data: claimed, error: claimError } = await db
      .from("mission_notification_logs")
      .update({ status: "pending", attempt_count: (existing.attempt_count ?? 0) + 1, last_error_code: null, sent_at: null, updated_at: nowIso })
      .eq("id", existing.id)
      .eq("updated_at", existing.updated_at)
      .select("id")
      .maybeSingle();
    if (claimError) throw new Error("MISSION_PUSH_LOG_CLAIM_FAILED");
    if (!claimed) return { outcome: "duplicate", childId, missionType, roundType: template.roundType, successfulSubscriptions: 0, failedSubscriptions: 0, errorCode: "DUPLICATE_REQUEST" };
  } else {
    const { error: insertError } = await db.from("mission_notification_logs").insert({
      child_id: childId,
      business_date: businessDate,
      round_type: template.roundType,
      source,
      status: "pending",
      attempt_count: 1,
      last_error_code: null,
      sent_at: null,
      updated_at: nowIso,
    });
    if (insertError?.code === "23505") {
      return { outcome: "duplicate", childId, missionType, roundType: template.roundType, successfulSubscriptions: 0, failedSubscriptions: 0, errorCode: "DUPLICATE_REQUEST" };
    }
    if (insertError) throw new Error("MISSION_PUSH_LOG_CREATE_FAILED");
  }

  const { data: subscriptions, error: subscriptionError } = await db
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("child_id", childId)
    .eq("role", "child")
    .eq("is_active", true)
    .eq("permission_status", "granted");
  if (subscriptionError) throw new Error("SUBSCRIPTION_LOOKUP_FAILED");

  let successfulSubscriptions = 0;
  let failedSubscriptions = 0;
  let lastErrorCode = "NO_ACTIVE_SUBSCRIPTION";
  for (const subscription of subscriptions ?? []) {
    try {
      await sendPushNotificationWithRetry(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        { title: template.title, body: template.body, url: template.url }
      );
      successfulSubscriptions += 1;
    } catch (error) {
      failedSubscriptions += 1;
      const status = getPushErrorStatus(error);
      lastErrorCode = status ? `PUSH_${status}` : "PUSH_FAILED";
      if (status === 404 || status === 410) {
        await db.from("push_subscriptions").update({ is_active: false, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", subscription.id);
      }
    }
  }

  const outcome = successfulSubscriptions > 0 ? "sent" : (subscriptions?.length ? "failed" : "no_subscription");
  const errorCode = successfulSubscriptions > 0 ? null : lastErrorCode;
  const { error: finalizeError } = await db
    .from("mission_notification_logs")
    .update({ status: successfulSubscriptions > 0 ? "sent" : "failed", last_error_code: errorCode, sent_at: successfulSubscriptions > 0 ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("child_id", childId)
    .eq("business_date", businessDate)
    .eq("round_type", template.roundType)
    .eq("source", source);
  if (finalizeError) throw new Error("MISSION_PUSH_LOG_FINALIZE_FAILED");

  return { outcome, childId, missionType, roundType: template.roundType, successfulSubscriptions, failedSubscriptions, errorCode };
}
