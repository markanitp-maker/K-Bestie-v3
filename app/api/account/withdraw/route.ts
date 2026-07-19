import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { sendAccountLifecycleNotification } from "@/lib/notifications/accountLifecycle";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { password, reason, successorUserId, confirmedLastGuardian } = body;

    const isEmailUser = user.app_metadata?.provider === "email" || user.identities?.some((id) => id.provider === "email");

    if (isEmailUser) {
      if (!password) {
        return NextResponse.json({ error: "Reauthentication required" }, { status: 401 });
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email!,
        password,
      });
      if (signInError) {
        return NextResponse.json({ error: "Invalid password" }, { status: 401 });
      }
    } else {
      // Social user check
      const lastSignInStr = user.last_sign_in_at;
      if (!lastSignInStr) {
        return NextResponse.json({ error: "재로그인 후 다시 시도해주세요" }, { status: 401 });
      }
      const lastSignIn = new Date(lastSignInStr).getTime();
      const now = Date.now();
      const diffMinutes = (now - lastSignIn) / (1000 * 60);
      if (diffMinutes > 15) {
        return NextResponse.json({ error: "재로그인 후 다시 시도해주세요" }, { status: 401 });
      }
    }

    const supabaseAdmin = createServiceClient();
    const { data, error } = await supabaseAdmin.rpc("request_account_withdrawal", {
      p_user_id: user.id,
      p_reason: reason || "사용자 자진 탈퇴",
      p_successor_user_id: successorUserId || null,
      p_confirmed_last_guardian: !!confirmedLastGuardian,
    });

    if (error) {
      console.error("[Withdrawal Error]", error);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    if (!data || !data[0].success) {
      const failReason = data?.[0]?.reason;
      if (failReason === "successor_required") {
        return NextResponse.json({ error: "successor_required" }, { status: 409 });
      }
      if (failReason === "last_guardian_confirmation_required") {
        return NextResponse.json({ error: "last_guardian_confirmation_required" }, { status: 409 });
      }
      return NextResponse.json({ error: failReason }, { status: 400 });
    }

    // 탈퇴 성공 시 세션 전체 무효화 (DB 상에서 모든 기기 로그아웃)
    const { error: revokeError } = await supabaseAdmin.rpc("revoke_all_sessions", {
      p_user_id: user.id,
    });

    if (revokeError) {
      console.error(`[Withdrawal Warning] revoke_all_sessions failed for user ${user.id}:`, revokeError);
      // 실패해도 진행
    }

    // 탈퇴 알림 발송
    await sendAccountLifecycleNotification(user.id, "unsubscribe_requested");
    await sendAccountLifecycleNotification(user.id, "grace_period_started");

    return NextResponse.json({ success: true, sessionRevokeFailed: !!revokeError });
  } catch (err: any) {
    console.error("[Withdrawal Exception]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
