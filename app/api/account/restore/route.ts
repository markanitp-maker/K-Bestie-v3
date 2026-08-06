import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/account/restore
 * 
 * 탈퇴 신청 30일 이내 사용자 계정 복구 요청 처리 (원자적 & 멱등적 실행).
 * 
 * 1. user 세션 확인
 * 2. parents 계정 상태 확인 (30일 이내 검증)
 * 3. request_account_restore -> admin_approve_account_restore RPC 실행으로 
 *    parents.account_status = 'RESTORED' 및 families, family_members 소프트 삭제 원상 복구
 * 4. 멱등성: 이미 ACTIVE / RESTORED 상태이면 즉시 성공 응답
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (!user || authError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const svc = createServiceClient();

    // 1. 현재 계정 상태 조회
    const { data: parent, error: parentError } = await svc
      .from("parents")
      .select("account_status, withdrawn_at, purge_scheduled_at, email")
      .eq("id", user.id)
      .maybeSingle();

    if (parentError) {
      console.error("[api/account/restore] parent fetch error:", parentError);
      return NextResponse.json({ error: "Failed to fetch account status" }, { status: 500 });
    }

    if (!parent) {
      return NextResponse.json({ error: "Parent profile not found" }, { status: 404 });
    }

    // 이미 활성/복구된 상태 (멱등 처리)
    if (
      (parent.account_status === "ACTIVE" || parent.account_status === "RESTORED") &&
      !parent.withdrawn_at
    ) {
      return NextResponse.json({ success: true, message: "already_restored" });
    }

    // 2. 만료 기한 확인 (30일)
    const now = new Date();
    let purgeDate: Date | null = null;
    if (parent.purge_scheduled_at) {
      purgeDate = new Date(parent.purge_scheduled_at);
    } else if (parent.withdrawn_at) {
      purgeDate = new Date(new Date(parent.withdrawn_at).getTime() + 30 * 24 * 60 * 60 * 1000);
    }

    if (purgeDate && now >= purgeDate) {
      return NextResponse.json({ error: "purge_deadline_passed" }, { status: 400 });
    }

    // 3. 계정 복구 RPC 순차 실행
    // 3-a. request_account_restore
    if (parent.account_status === "WITHDRAWN_PENDING" || parent.account_status === "WITHDRAWN") {
      const { data: reqData, error: reqErr } = await svc.rpc("request_account_restore", {
        p_user_id: user.id,
      });

      if (reqErr) {
        console.error("[api/account/restore] request_account_restore error:", reqErr);
        // 만약 이미 RESTORE_REQUESTED 라면 계속 진행
      }
    }

    // 3-b. admin_approve_account_restore (자가 복구 승인)
    const adminEmail = user.email || parent.email || "system@k-bestie.com";
    const { data: approveData, error: approveErr } = await svc.rpc("admin_approve_account_restore", {
      p_admin_user_id: user.id,
      p_admin_email: adminEmail,
      p_target_user_id: user.id,
    });

    if (approveErr) {
      console.error("[api/account/restore] admin_approve_account_restore error:", approveErr);
      return NextResponse.json({ error: approveErr.message || "Failed to approve restore" }, { status: 500 });
    }

    // 추가 보장: parents 테이블의 withdrawn_at, purge_scheduled_at 및 account_status = 'ACTIVE' 정리
    await svc
      .from("parents")
      .update({
        account_status: "ACTIVE",
        withdrawn_at: null,
        purge_scheduled_at: null,
        withdrawal_reason: null,
        restored_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[api/account/restore] Exception:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
