import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendAccountLifecycleNotification } from "@/lib/notifications/accountLifecycle";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // 인증 검증
  const secret = process.env.BATCH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "BATCH_SECRET env not set" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabaseAdmin = createServiceClient();
    
    // 1. 파기 대상 및 임박 알림 대상 찾기
    const { data: parents, error: pError } = await supabaseAdmin
      .from("parents")
      .select("id, email, name, account_status, purge_scheduled_at")
      .eq("account_status", "WITHDRAWN_PENDING");

    if (pError) {
      console.error("[Account Purge Error] parents fetch failed:", pError);
      return NextResponse.json({ error: "parents fetch error" }, { status: 500 });
    }

    if (!parents || parents.length === 0) {
      return NextResponse.json({ success: true, count: 0, message: "No accounts to process" });
    }

    let purgedCount = 0;

    // 2. 각 대상에 대해 순차적으로 알림 및 물리삭제 수행
    for (const parent of parents) {
      try {
        if (!parent.purge_scheduled_at) continue;

        const scheduledAt = new Date(parent.purge_scheduled_at).getTime();
        const now = Date.now();
        const diffDays = (scheduledAt - now) / (1000 * 60 * 60 * 24);

        if (diffDays > 0) {
          // 파기 임박 알림 처리 (7일 전 / 1일 전)
          const { data: notifs } = await supabaseAdmin
            .from("account_lifecycle_notifications")
            .select("event_type")
            .eq("parent_id", parent.id)
            .in("event_type", ["deletion_warning_7d", "deletion_warning_1d"]);
          
          const sent1d = notifs?.some(n => n.event_type === "deletion_warning_1d");
          const sent7d = notifs?.some(n => n.event_type === "deletion_warning_7d");

          if (diffDays <= 1 && !sent1d) {
            await sendAccountLifecycleNotification(parent.id, "deletion_warning_1d");
          } else if (diffDays <= 7 && diffDays > 1 && !sent7d) {
            await sendAccountLifecycleNotification(parent.id, "deletion_warning_7d");
          }
          continue; // 파기 대상이 아니므로 다음으로 넘어감
        }

        // 새 RPC 호출: 원자적으로 가족 물리삭제 및 부모 계정 비식별화/상태 변경
        const { error: purgeRpcError } = await supabaseAdmin.rpc("purge_account_family_data", {
          p_user_id: parent.id,
        });

        if (purgeRpcError) {
          console.error(`[Account Purge Error] RPC failed for user ${parent.id}:`, purgeRpcError);
          continue;
        }

        // admin_audit_log 이메일 비식별화
        await supabaseAdmin
          .from("admin_audit_log")
          .update({ admin_email: `purged-${parent.id.substring(0, 8)}@deleted.local` })
          .eq("admin_user_id", parent.id);

        // auth.users 물리 삭제 (best-effort)
        // 실패하더라도 DB 레벨에서는 PURGED 상태로 잘 분리되어 있으므로 서비스 지장 없음
        const { error: delError } = await supabaseAdmin.auth.admin.deleteUser(parent.id);
        if (delError) {
          console.error(`[Account Purge Warning] Failed to delete auth user ${parent.id}, but DB purge succeeded.`, delError);
        }

        // 파기 감사 로그 기록 (기존과 동일)
        await supabaseAdmin
          .from("admin_audit_log")
          .insert({
            admin_user_id: parent.id,
            admin_email: `purged-${parent.id.substring(0, 8)}@deleted.local`,
            action: "account_purged",
            target_user_id: parent.id
          });

        // 파기 완료 알림 발송 (물리 삭제 완료 후 기록)
        await sendAccountLifecycleNotification(parent.id, "deleted");

        purgedCount++;
      } catch (err) {
        console.error(`[Account Purge Error] Exception processing user ${parent.id}`, err);
      }
    }

    return NextResponse.json({ success: true, count: purgedCount });
  } catch (err: any) {
    console.error("[Account Purge Exception]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
