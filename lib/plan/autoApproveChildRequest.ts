import { createServiceClient } from "@/lib/supabase/server";
import { getChildApprovalEncryptionKey } from "@/lib/plan/childApprovalEncryption";
import {
  createChildAuthAccountWithOrphanRecovery,
  cleanupNewlyCreatedChildAuthAccount,
  CHILD_ACCOUNT_CREATE_FAILED,
} from "@/lib/plan/createChildAuthAccount";

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
 *
 * 2026-08-11: auth.admin.createUser 이후 단계(family_members/member_accounts/
 * child_profiles/finalize/부모 ACTIVE 전환) 중 하나라도 실패하면, 이번 호출에서 새로
 * 만든 Auth 계정(authUserNewlyCreated)에 한해 auth.admin.deleteUser로 반드시 되돌린다 —
 * 그러지 않으면 아무 데이터에도 연결되지 않은 Auth 고아 계정이 남아 같은 아이디로 영구히
 * 재등록할 수 없게 된다(Production hks@kbestie.local 인시던트로 실측 확인). 반환하는
 * error는 이제 화면에 그대로 노출할 문구가 아니라 코드다 — 호출부(children/route.ts,
 * approve/route.ts)가 CHILD_LOGIN_ID_ALREADY_EXISTS/CHILD_ACCOUNT_CREATE_FAILED 등을
 * 사용자 문구로 매핑한다.
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
  // 이번 호출에서 새로 만든 Auth 계정인지 여부 — true일 때만 이후 단계 실패 시 보상 삭제
  // 대상이 된다(claim.created_auth_user_id로 이미 존재하던 계정은 재시도 재사용 대상이므로
  // 여기서 실패했다고 삭제하지 않는다).
  let authUserNewlyCreated = false;
  if (!authUserId) {
    const created = await createChildAuthAccountWithOrphanRecovery(svc, {
      username: claim.username!,
      password: claim.decrypted_password!,
      name,
    });
    if (!created.ok) {
      await svc.rpc("admin_finalize_child_approval_failure", {
        p_request_id: requestId,
        p_admin_user_id: requestedByUserId,
        p_admin_email: requestedByEmail,
        p_reason: created.internalReason,
      });
      return { success: false, error: created.errorCode };
    }
    authUserId = created.authUserId;
    authUserNewlyCreated = true;
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
      return { success: false, error: CHILD_ACCOUNT_CREATE_FAILED };
    }
  }

  const { data: familyMember, error: fmError } = await svc
    .from("family_members")
    .insert({ family_id: familyId, user_id: authUserId, role: "child" })
    .select("id")
    .single();
  if (fmError) {
    if (authUserNewlyCreated) await cleanupNewlyCreatedChildAuthAccount(svc, requestId, authUserId);
    await svc.rpc("admin_finalize_child_approval_failure", {
      p_request_id: requestId,
      p_admin_user_id: requestedByUserId,
      p_admin_email: requestedByEmail,
      p_reason: `가족 등록 실패: ${fmError.message}`,
    });
    return { success: false, error: CHILD_ACCOUNT_CREATE_FAILED };
  }

  const { error: accError } = await svc.from("member_accounts").insert({
    id: authUserId,
    username: claim.username,
    email: null,
    display_name: name,
    family_id: familyId,
    role: "child",
    created_by: requestedByUserId,
    must_change_password: false,
  });
  if (accError) {
    if (authUserNewlyCreated) await cleanupNewlyCreatedChildAuthAccount(svc, requestId, authUserId);
    await svc.from("family_members").delete().eq("id", familyMember.id);
    await svc.rpc("admin_finalize_child_approval_failure", {
      p_request_id: requestId,
      p_admin_user_id: requestedByUserId,
      p_admin_email: requestedByEmail,
      p_reason: `계정 정보 저장 실패: ${accError.message}`,
    });
    return { success: false, error: CHILD_ACCOUNT_CREATE_FAILED };
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
    if (authUserNewlyCreated) await cleanupNewlyCreatedChildAuthAccount(svc, requestId, authUserId);
    await svc.from("member_accounts").delete().eq("id", authUserId);
    await svc.from("family_members").delete().eq("id", familyMember.id);
    await svc.rpc("admin_finalize_child_approval_failure", {
      p_request_id: requestId,
      p_admin_user_id: requestedByUserId,
      p_admin_email: requestedByEmail,
      p_reason: `아이 프로필 생성 실패: ${childErr.message}`,
    });
    return { success: false, error: CHILD_ACCOUNT_CREATE_FAILED };
  }

  const { data: finalizeData, error: finalizeError } = await svc.rpc("admin_finalize_child_approval_success", {
    p_request_id: requestId,
    p_admin_user_id: requestedByUserId,
    p_admin_email: requestedByEmail,
    p_child_id: child.id,
    p_approval_method: "BETA_AUTO",
  });

  if (finalizeError || !finalizeData?.[0]?.success) {
    console.error("[autoApproveChildRequest] finalize error:", finalizeError, finalizeData);
    if (authUserNewlyCreated) await cleanupNewlyCreatedChildAuthAccount(svc, requestId, authUserId);
    await svc.from("child_profiles").delete().eq("id", child.id);
    await svc.from("member_accounts").delete().eq("id", authUserId);
    await svc.from("family_members").delete().eq("id", familyMember.id);
    await svc.rpc("admin_finalize_child_approval_failure", {
      p_request_id: requestId,
      p_admin_user_id: requestedByUserId,
      p_admin_email: requestedByEmail,
      p_reason: "승인 확정 처리에 실패했습니다.",
    });
    return { success: false, error: CHILD_ACCOUNT_CREATE_FAILED };
  }

  // ── 온보딩 최종 단계 완료: 보호자 계정을 ACTIVE로 전환 ──────────────────────
  // 가족 생성 + 최초 아이 등록 + 법정대리인 동의 + 아이 승인이 모두 원자적으로 성공한
  // 이 시점에서만 account_status를 ACTIVE로 바꾼다.
  const { data: updatedParents, error: activateError } = await svc
    .from("parents")
    .update({
      account_status: "ACTIVE",
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq("id", requestedByUserId)
    .in("account_status", ["AUTHENTICATED_INCOMPLETE", "ONBOARDING", "ACTIVE", "RESTORED"])
    .select("id, account_status, onboarding_completed_at");

  if (activateError || !updatedParents || updatedParents.length === 0) {
    console.error("[autoApproveChildRequest] 부모 ACTIVE 전환 실패:", activateError, updatedParents);
    if (authUserNewlyCreated) await cleanupNewlyCreatedChildAuthAccount(svc, requestId, authUserId);
    await svc.from("child_profiles").delete().eq("id", child.id);
    await svc.from("member_accounts").delete().eq("id", authUserId);
    await svc.from("family_members").delete().eq("id", familyMember.id);
    await svc.rpc("admin_finalize_child_approval_failure", {
      p_request_id: requestId,
      p_admin_user_id: requestedByUserId,
      p_admin_email: requestedByEmail,
      p_reason: "보호자 계정 활성화 처리에 실패했습니다.",
    });
    return { success: false, error: CHILD_ACCOUNT_CREATE_FAILED };
  }

  return { success: true, childId: child.id };
}
