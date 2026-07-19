import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { sendAccountLifecycleNotification } from "@/lib/notifications/accountLifecycle";

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseAdmin = createServiceClient();
    const { data, error } = await supabaseAdmin.rpc("request_account_restore", {
      p_user_id: user.id,
    });

    if (error) {
      console.error("[Restore Request Error]", error);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    if (!data || !data[0].success) {
      return NextResponse.json({ error: data?.[0]?.reason }, { status: 400 });
    }

    // 복구 알림 발송
    await sendAccountLifecycleNotification(user.id, "restore_requested");

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[Restore Request Exception]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
