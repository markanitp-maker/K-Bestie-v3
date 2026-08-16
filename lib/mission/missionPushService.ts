import { createServiceClient } from "@/lib/supabase/server";
import { getPushErrorCode, getPushErrorStatus, sendPushNotificationWithRetry } from "@/lib/notifications/push";
import { childAuthUserId, createInboxNotification } from "@/lib/notifications/inbox";

export type MissionPushType = 1 | 2;
export type MissionPushSource = "cron" | "admin_test";

// Historical v2-only adapter. round1_day/round2_night와 missionType 1/2 계약은
// 과거 알림 로그 조회 및 별도 cutover 전 관리자 회귀 테스트용으로만 보존한다.
// Mission v3 daily_single 운영 알림에서 이 서비스를 재사용하지 않는다.

export type MissionPushResult = {
  outcome: "sent" | "failed" | "no_subscription" | "duplicate" | "already_sent";
  childId: string;
  missionType: MissionPushType;
  roundType: "round1_day" | "round2_night";
  successfulSubscriptions: number;
  failedSubscriptions: number;
  errorCode: string | null;
};

/** 오늘 미션을 어디까지 했는지. Push 문구를 가른다(079 §5·§7). */
export type MissionPushProgressState = "NOT_STARTED" | "IN_PROGRESS";

/**
 * Mission v3는 하루 1회다. 사용자 노출 문구에 V2 라운드 개념(1차/2차/낮/저녁)을
 * 쓰지 않는다(079 §5 금지 목록). round_type은 기존 로그 조회·중복방지 키라
 * 그대로 두고 문구만 V3화한다 — 바꾸면 과거 발송 이력과 어긋난다.
 */
export function missionPushTemplate(
  missionType: MissionPushType,
  progressState: MissionPushProgressState = "NOT_STARTED",
) {
  const inProgress = progressState === "IN_PROGRESS";
  return {
    roundType: missionType === 1 ? "round1_day" as const : "round2_night" as const,
    title: inProgress ? "오늘의 미션을 이어가 볼까?" : "오늘의 미션 시간이야!",
    body: inProgress
      ? "케이가 기다리고 있어요."
      : "케이와 오늘 이야기를 시작해 볼까요?",
    url: "/child/missions",
  };
}

export function isRecentAdminTest(updatedAt: string, now = Date.now(), cooldownMs = 30_000) {
  const timestamp = new Date(updatedAt).getTime();
  return Number.isFinite(timestamp) && now - timestamp < cooldownMs;
}

export function shouldDeactivateMissionPushSubscription(status: number | null) {
  return status === 404 || status === 410;
}

function kstBusinessDate() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function sendMissionStartPushToChild({
  childId,
  missionType,
  source,
  progressState = "NOT_STARTED",
}: {
  childId: string;
  missionType: MissionPushType;
  source: MissionPushSource;
  progressState?: MissionPushProgressState;
}): Promise<MissionPushResult> {
  const db = createServiceClient();
  const template = missionPushTemplate(missionType, progressState);
  const businessDate = kstBusinessDate();
  const nowIso = new Date().toISOString();

  const { data: child, error: childError } = await db.from("child_profiles").select("id").eq("id", childId).maybeSingle();
  if (childError) throw new Error("CHILD_LOOKUP_FAILED");
  if (!child) throw new Error("CHILD_NOT_FOUND");

  const childUserId = await childAuthUserId(db, childId);
  const inboxNotification = childUserId
    ? await createInboxNotification(db, {
        userId: childUserId,
        childId,
        role: "child",
        type: "mission",
        title: template.title,
        body: template.body,
        targetUrl: template.url,
        sourceId: `${businessDate}:${template.roundType}:${source}`,
        idempotencyKey: `mission:${childId}:${businessDate}:${template.roundType}:${source}`,
      })
    : null;

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
        { title: template.title, body: template.body, url: template.url, notificationId: inboxNotification?.id ?? null }
      );
      successfulSubscriptions += 1;
    } catch (error) {
      failedSubscriptions += 1;
      const status = getPushErrorStatus(error);
      lastErrorCode = getPushErrorCode(error);
      // 403은 VAPID 인증/권한 진단 대상이며 구독 자체의 만료를 뜻하지 않는다.
      // 실제 stale/expired subscription으로 확인되는 404/410만 비활성화한다.
      if (shouldDeactivateMissionPushSubscription(status)) {
        const { error: deactivateError } = await db
          .from("push_subscriptions")
          .update({ is_active: false, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", subscription.id);
        if (deactivateError) {
          console.error("[missionPushService] failed to deactivate stale subscription", subscription.id, deactivateError.message);
        }
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
