import { createServiceClient } from "@/lib/supabase/server";
import { getChildApprovalEncryptionKey } from "@/lib/plan/childApprovalEncryption";
import { toAuthEmail } from "@/lib/plan/childAuthEmail";

/**
 * 베타 기간 아이 승인 요청 자동 승인 — 요청서 §7.1.
 *
 * app/api/admin/child-approval-requests/[id]/approve/route.ts(관리자 수동 승인)와 완전히
 * 동일한 RPC 시퀀스(admin_claim_child_approval_request → auth.admin.createUser →
 * family_members/member_accounts/child_profiles insert → admin_finalize_child_approval_success)
 * 를 그대로 호출한다 — 같은 테이블/RPC를 쓰므로 관리자 승인 관리 화면에는 이 경로로 승인된
 * 요청도 완전히 동일하게 "승인 완료" 상태로 보인다(요청서 "단순히 프런트 화면만 승인으로
 * 표시하지 말고 실제 DB 승인 상태와 관리자 화면도 동일하게 반영" 요구사항 충족).
 *
 * 의도적으로 코드를 중복시켰다(관리자 approve 라우트를 import/리팩터링하지 않음) — 이 티켓과
 * 동시에 다른 세션이 child_approval_requests 관련 관리자 화면(소프트 삭제/휴지통)을 작업 중이라
 * 그 파일을 건드리면 충돌 위험이 있기 때문이다. reviewed_by/admin_email 자리에는 실제 관리자가
 * 아니라 "요청을 발생시킨 본인(보호자)"의 id/email을 그대로 넘긴다 — 베타 자동승인은 대표님이
 * 아니라 시스템이 본인 요청을 즉시 확정하는 것이므로, 감사 기록상 "누가 승인했는지"를 거짓으로
 * 꾸미지 않고 있는 그대로 남긴다.
 */
export async function autoApproveChildRequest(
  requestId: string,
  requestedByUserId: string,
  requestedByEmail: string
): Promise<{ success: boolean; childId?: string; error?: string }> {
  const svc = createServiceClient();

  const { data: claimData, error: claimError } = await svc.rpc("admin_claim_child_approval_request", {
    p_request_id: requestId,
    p_encryption_key: getChildApprovalEncryptionKey(),
    p_beta_verified: true,
    p_survey_verified: true,
  });

  if (claimError) {
    console.error("[autoApproveChildRequest] claim RPC error:", claimError);
    return { success: false, error: "claim_failed" };
  }

  const claim = claimData?.[0] as {
    success: boolean;
    reason: string | null;
    family_id: string | null;
    family_name: string | null;
    given_name: string | null;
    gender: string | null;
    username: string | null;
    decrypted_password: string | null;
    grade: string | null;
    interests: string[] | null;
    guardian_consent: boolean | null;
    guardian_consent_version: string | null;
    guardian_consent_requested_at: string | null;
    created_auth_user_id: string | null;
    created_child_id: string | null;
  } | undefined;

  if (!claim?.success) {
    console.error("[autoApproveChildRequest] claim not successful:", claim?.reason);
    return { success: false, error: claim?.reason ?? "claim_not_successful" };
  }

  const familyId = claim.family_id!;
  const name = `${claim.family_name}${claim.given_name}`;

  let authUserId = claim.created_auth_user_id;
  if (!authUserId) {
    const { data: authData, error: authError } = await svc.auth.admin.createUser({
      email: toAuthEmail(claim.username!),
      password: claim.decrypted_password!,
      email_confirm: true,
      user_metadata: { name, username: claim.username, is_member_account: true },
    });
    if (authError) {
      await svc.rpc("admin_finalize_child_approval_failure", {
        p_request_id: requestId,
        p_admin_user_id: requestedByUserId,
        p_admin_email: requestedByEmail,
        p_reason: `계정 생성 실패: ${authError.message}`,
      });
      return { success: false, error: `계정 생성 실패: ${authError.message}` };
    }
    authUserId = authData.user.id;
    const { data: recordData, error: recordError } = await svc.rpc("admin_record_child_approval_auth_created", {
      p_request_id: requestId,
      p_auth_user_id: authUserId,
    });
    if (recordError || !recordData?.[0]?.success) {
      await svc.auth.admin.deleteUser(authUserId);
      await svc.rpc("admin_finalize_child_approval_failure", {
        p_request_id: requestId,
        p_admin_user_id: requestedByUserId,
        p_admin_email: requestedByEmail,
        p_reason: "생성된 계정 연결 정보를 저장하지 못했습니다.",
      });
      return { success: false, error: "계정 연결 정보를 저장하지 못했습니다." };
    }
  }

  const { data: familyMember, error: fmError } = await svc
    .from("family_members")
    .insert({ family_id: familyId, user_id: authUserId, role: "child" })
    .select("id")
    .single();
  if (fmError) {
    await svc.rpc("admin_finalize_child_approval_failure", {
      p_request_id: requestId,
      p_admin_user_id: requestedByUserId,
      p_admin_email: requestedByEmail,
      p_reason: `가족 등록 실패: ${fmError.message}`,
    });
    return { success: false, error: `가족 등록 실패: ${fmError.message}` };
  }

  const { error: accError } = await svc.from("member_accounts").insert({
    id: authUserId,
    username: claim.username,
    email: null,
    display_name: name,
    family_id: familyId,
    role: "child",
    created_by: requestedByUserId,
    must_change_password: true,
  });
  if (accError) {
    await svc.from("family_members").delete().eq("id", familyMember.id);
    await svc.rpc("admin_finalize_child_approval_failure", {
      p_request_id: requestId,
      p_admin_user_id: requestedByUserId,
      p_admin_email: requestedByEmail,
      p_reason: `계정 정보 저장 실패: ${accError.message}`,
    });
    return { success: false, error: `계정 정보 저장 실패: ${accError.message}` };
  }

  const { data: child, error: childErr } = await svc
    .from("child_profiles")
    .insert({
      family_id: familyId,
      member_id: familyMember.id,
      name,
      family_name: claim.family_name,
      given_name: claim.given_name,
      gender: claim.gender,
      grade: claim.grade,
      interests: claim.interests,
      email: null,
      tier: 2,
      guardian_consent: true,
      guardian_consent_at: claim.guardian_consent_requested_at ?? new Date().toISOString(),
      guardian_consent_version: claim.guardian_consent_version,
    })
    .select("id")
    .single();
  if (childErr) {
    await svc.from("member_accounts").delete().eq("id", authUserId);
    await svc.from("family_members").delete().eq("id", familyMember.id);
    await svc.rpc("admin_finalize_child_approval_failure", {
      p_request_id: requestId,
      p_admin_user_id: requestedByUserId,
      p_admin_email: requestedByEmail,
      p_reason: `아이 프로필 생성 실패: ${childErr.message}`,
    });
    return { success: false, error: `아이 프로필 생성 실패: ${childErr.message}` };
  }

  const { data: finalizeData, error: finalizeError } = await svc.rpc("admin_finalize_child_approval_success", {
    p_request_id: requestId,
    p_admin_user_id: requestedByUserId,
    p_admin_email: requestedByEmail,
    p_child_id: child.id,
  });

  if (finalizeError || !finalizeData?.[0]?.success) {
    console.error("[autoApproveChildRequest] finalize error:", finalizeError, finalizeData);
    await svc.from("child_profiles").delete().eq("id", child.id);
    await svc.from("member_accounts").delete().eq("id", authUserId);
    await svc.from("family_members").delete().eq("id", familyMember.id);
    await svc.rpc("admin_finalize_child_approval_failure", {
      p_request_id: requestId,
      p_admin_user_id: requestedByUserId,
      p_admin_email: requestedByEmail,
      p_reason: "승인 확정 처리에 실패했습니다.",
    });
    return { success: false, error: "승인 확정 처리에 실패했습니다" };
  }

  return { success: true, childId: child.id };
}
