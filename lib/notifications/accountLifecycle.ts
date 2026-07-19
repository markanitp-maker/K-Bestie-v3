import { createServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/mail";
import { getEmailTemplate } from "./emailTemplates";

// 재시도 간격 계산 (지수백오프: 5분, 30분, 2시간)
function getNextRetryAt(currentRetryCount: number): string | null {
  const now = Date.now();
  if (currentRetryCount === 0) {
    return new Date(now + 5 * 60 * 1000).toISOString(); // 5분
  } else if (currentRetryCount === 1) {
    return new Date(now + 30 * 60 * 1000).toISOString(); // 30분
  } else if (currentRetryCount === 2) {
    return new Date(now + 2 * 60 * 60 * 1000).toISOString(); // 2시간
  }
  return null; // 최대 3회 재시도 (0, 1, 2)
}

export async function sendAccountLifecycleNotification(parentId: string, eventType: string) {
  const supabaseAdmin = createServiceClient();

  // 1. 사용자 이메일 조회
  const { data: parent } = await supabaseAdmin
    .from("parents")
    .select("email")
    .eq("id", parentId)
    .single();

  const email = parent?.email;

  // 2. 이메일 발송
  const emailPromise = (async () => {
    if (!email) throw new Error("No email found for user");

    const template = getEmailTemplate(eventType);

    const res = await sendEmail({ to: email, subject: template.subject, html: template.html });
    if (!res.sent && !res.simulated) {
      throw new Error(res.error || "Email sending failed");
    }

    await supabaseAdmin.from("account_lifecycle_notifications").insert({
      parent_id: parentId,
      event_type: eventType,
      channel: "email",
      status: "success",
      template_key: eventType,
    });
  })().catch(async (err) => {
    console.error(`[Email Notification Error] ${parentId}:`, err);
    const nextRetryAt = getNextRetryAt(0);
    await supabaseAdmin.from("account_lifecycle_notifications").insert({
      parent_id: parentId,
      event_type: eventType,
      channel: "email",
      status: "failed",
      error_message: err.message,
      retry_count: 1,
      next_retry_at: nextRetryAt,
      template_key: eventType,
    });
    throw err;
  });

  // 3. 푸시 발송 (스텁)
  const pushPromise = (async () => {
    // TODO: push_subscription 테이블이 없으므로 현재는 푸시 발송 생략 (인터페이스만 준비)
    // await sendWebPush(...)
  })().catch(async (err) => {
    console.error(`[Push Notification Error] ${parentId}:`, err);
    const nextRetryAt = getNextRetryAt(0);
    await supabaseAdmin.from("account_lifecycle_notifications").insert({
      parent_id: parentId,
      event_type: eventType,
      channel: "push",
      status: "failed",
      error_message: err.message,
      retry_count: 1,
      next_retry_at: nextRetryAt,
      template_key: eventType,
    });
    throw err;
  });

  // Promise.allSettled로 병렬 처리 (에러가 발생해도 다른 채널 발송에 영향 없도록)
  await Promise.allSettled([emailPromise, pushPromise]);
}

export async function getRetryableNotifications() {
  const supabaseAdmin = createServiceClient();
  const { data, error } = await supabaseAdmin
    .from("account_lifecycle_notifications")
    .select("*")
    .lt("next_retry_at", new Date().toISOString())
    .lt("retry_count", 4) // 최대 재시도 방어
    .eq("status", "failed");

  if (error) {
    console.error("Failed to fetch retryable notifications:", error);
    return [];
  }
  return data;
}
