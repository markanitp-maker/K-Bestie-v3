import type { SupabaseClient } from "@supabase/supabase-js";
import { getPushErrorCode, getPushErrorStatus, sendPushNotificationWithRetry } from "@/lib/notifications/push";

type NotificationRow = {
  id: string;
  user_id: string;
  child_id: string | null;
  role: "parent" | "child";
  title: string;
  body: string;
  target_url: string;
};

type SubscriptionRow = {
  id: string;
  user_id: string;
  child_id: string | null;
  role: "parent" | "child";
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type SupportPushResult = {
  notifications: number;
  sent: number;
  failed: number;
  noSubscription: number;
};

export async function sendSupportNotificationPushes(
  db: SupabaseClient,
  notificationIds: string[]
): Promise<SupportPushResult> {
  const uniqueIds = Array.from(new Set(notificationIds.filter(Boolean)));
  const result: SupportPushResult = { notifications: uniqueIds.length, sent: 0, failed: 0, noSubscription: 0 };
  if (!uniqueIds.length) return result;

  const { data: notifications, error } = await db
    .from("notifications")
    .select("id,user_id,child_id,role,title,body,target_url")
    .in("id", uniqueIds);
  if (error) throw new Error("SUPPORT_NOTIFICATION_LOOKUP_FAILED");

  const rows = (notifications ?? []) as NotificationRow[];
  const userIds = Array.from(new Set(rows.map((item) => item.user_id)));
  const { data: subscriptions, error: subscriptionError } = await db
    .from("push_subscriptions")
    .select("id,user_id,child_id,role,endpoint,p256dh,auth")
    .in("user_id", userIds)
    .eq("is_active", true)
    .eq("permission_status", "granted");
  if (subscriptionError) throw new Error("SUPPORT_SUBSCRIPTION_LOOKUP_FAILED");

  const deliveries: Array<{ notification: NotificationRow; subscription: SubscriptionRow }> = [];
  for (const notification of rows) {
    const matching = ((subscriptions ?? []) as SubscriptionRow[]).filter((subscription) =>
      subscription.user_id === notification.user_id
      && subscription.role === notification.role
      && (notification.role !== "child" || subscription.child_id === notification.child_id)
    );
    if (!matching.length) result.noSubscription += 1;
    for (const subscription of matching) deliveries.push({ notification, subscription });
  }

  const settled = await Promise.allSettled(deliveries.map(async ({ notification, subscription }) => {
    await sendPushNotificationWithRetry(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      { title: notification.title, body: notification.body, url: notification.target_url, notificationId: notification.id }
    );
    return { notificationId: notification.id, subscriptionId: subscription.id };
  }));

  for (let index = 0; index < settled.length; index += 1) {
    const delivery = deliveries[index];
    const deliveryResult = settled[index];
    if (deliveryResult.status === "fulfilled") {
      result.sent += 1;
      continue;
    }
    result.failed += 1;
    const status = getPushErrorStatus(deliveryResult.reason);
    console.error("[support-notifications] push failed", {
      notificationId: delivery.notification.id,
      code: getPushErrorCode(deliveryResult.reason),
      status,
    });
    if (status === 404 || status === 410) {
      const { error: deactivateError } = await db
        .from("push_subscriptions")
        .update({ is_active: false, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", delivery.subscription.id);
      if (deactivateError) {
        console.error("[support-notifications] stale subscription cleanup failed", { subscriptionId: delivery.subscription.id });
      }
    }
  }
  return result;
}

export function notificationIdsFromRpc(data: unknown): string[] {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return [];
  const value = (data as { notification_ids?: unknown }).notification_ids;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}
