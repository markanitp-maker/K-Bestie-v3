import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPushErrorStatus, sendPushNotificationWithRetry } from "@/lib/notifications/push";

export const runtime = "nodejs";
const kstDate = (offsetDays = 0) => {
  const date = new Date(Date.now() + 9 * 60 * 60 * 1000);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET || process.env.BATCH_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createServiceClient();
  const yesterday = kstDate(-1);
  const results = { sent: 0, skippedNoReport: 0, skippedAlreadySent: 0, failed: 0 };

  const { data: parents, error: parentsError } = await db.from("parents").select("id").eq("report_push_enabled", true).eq("account_status", "ACTIVE");
  if (parentsError) return NextResponse.json({ error: "Parent lookup failed" }, { status: 500 });

  for (const parent of parents ?? []) {
    const { data: preference } = await db.from("notification_preferences").select("parent_report_enabled").eq("user_id", parent.id).eq("role", "parent").eq("scope_key", "parent").maybeSingle();
    if (preference && !preference.parent_report_enabled) continue;

    const { data: memberships } = await db.from("family_members").select("family_id").eq("user_id", parent.id).in("role", ["parent", "owner_parent"]).is("deleted_at", null);
    const familyIds = [...new Set((memberships ?? []).map((row) => row.family_id))];
    if (!familyIds.length) continue;
    const { data: children } = await db.from("child_profiles").select("id,name").in("family_id", familyIds);
    const childIds = (children ?? []).map((row) => row.id);
    if (!childIds.length) continue;
    const { data: reports } = await db.from("daily_reports").select("id,child_id").in("child_id", childIds).eq("business_date", yesterday).is("deleted_at", null);
    if (!reports?.length) { results.skippedNoReport++; continue; }

    const { data: existing } = await db.from("report_notification_logs").select("id,status,attempt_count").eq("parent_id", parent.id).eq("notification_date", yesterday).eq("notification_type", "DAILY_REPORT").eq("report_type", "daily").maybeSingle();
    if (existing?.status === "sent") { results.skippedAlreadySent++; continue; }
    const log = { parent_id: parent.id, notification_type: "DAILY_REPORT", notification_date: yesterday, report_type: "daily", status: "pending", attempt_count: (existing?.attempt_count ?? 0) + 1, last_error_code: null, updated_at: new Date().toISOString() };
    await db.from("report_notification_logs").upsert(log, { onConflict: "parent_id,notification_date,notification_type,report_type" });

    const reportChildIds = new Set(reports.map((row) => row.child_id));
    const names = (children ?? []).filter((row) => reportChildIds.has(row.id)).map((row) => row.name);
    const title = names.length === 1 ? `${names[0]}의 새 리포트가 도착했어요` : "아이들의 새 리포트가 도착했어요";
    const url = reports.length === 1 ? `/parent/report/${reports[0].id}` : "/parent/report";
    const { data: subscriptions } = await db.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id", parent.id).eq("role", "parent").eq("is_active", true).eq("permission_status", "granted");
    let successful = 0;
    let lastError = "NO_ACTIVE_SUBSCRIPTION";
    for (const subscription of subscriptions ?? []) {
      try {
        await sendPushNotificationWithRetry({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, { title, body: "어제의 이야기와 오늘 나눌 대화를 확인해 보세요.", url });
        successful++;
      } catch (error) {
        const status = getPushErrorStatus(error);
        lastError = status ? `PUSH_${status}` : "PUSH_FAILED";
        if (status === 404 || status === 410) await db.from("push_subscriptions").update({ is_active: false, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", subscription.id);
      }
    }
    await db.from("report_notification_logs").update({ status: successful ? "sent" : "failed", last_error_code: successful ? null : lastError, sent_at: successful ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("parent_id", parent.id).eq("notification_date", yesterday).eq("notification_type", "DAILY_REPORT").eq("report_type", "daily");
    if (successful) results.sent++; else results.failed++;
  }
  return NextResponse.json({ ok: true, results });
}
