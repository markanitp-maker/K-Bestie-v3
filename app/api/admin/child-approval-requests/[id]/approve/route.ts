import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { getChildApprovalEncryptionKey } from "@/lib/plan/childApprovalEncryption";
import { toAuthEmail } from "@/lib/plan/childAuthEmail";

export const runtime = "nodejs";

// POST /api/admin/child-approval-requests/[id]/approve
// 053: 아이 승인 요청 승인 처리. auth.admin.createUser는 Node에서만 호출 가능하므로 진짜 SQL
// 트랜잭션이 아니라 app/api/families/[id]/children/route.ts(구 즉시생성 흐름)와 동일한
// 보상-트랜잭션 컨벤션으로 처리한다. 재시도 시 이미 생성된 auth 계정/프로필이 있으면 그대로
// 재사용하고 중복 생성하지 않는다(admin_claim_child_approval_request가 스냅샷으로 반환).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const supabase = await createClient();
  const { data: { user: adminUser } } = await supabase.auth.getUser();
  if (!adminUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { betaVerified?: boolean; surveyVerified?: boolean };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if (body.betaVerified !== true || body.surveyVerified !== true) {
    return NextResponse.json(
      { error: "베타 신청과 설문 완료를 모두 확인해주세요." },
      { status: 400 }
    );
  }

  const svc = createServiceClient();

  // 1. 클레임 + 스냅샷 조회 (동시 처리 방지 - 이미 처리 중/완료된 요청이면 즉시 중단)
  const { data: claimData, error: claimError } = await svc.rpc("admin_claim_child_approval_request", {
    p_request_id: id,
    p_encryption_key: getChildApprovalEncryptionKey(),
    p_beta_verified: true,
    p_survey_verified: true,
  });

  if (claimError) {
    console.error("[child-approval-requests/approve] claim RPC error:", claimError);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
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
    return NextResponse.json(
      { error: "이미 처리 중이거나 처리된 요청입니다. 새로고침 후 다시 확인해주세요." },
      { status: 409 }
    );
  }

  const familyId = claim.family_id!;
  const name = `${claim.family_name}${claim.given_name}`;

  // 2. auth 계정 확보 (재시도 시 기존 계정 재사용, 신규면 생성 즉시 기록)
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
        p_request_id: id,
        p_admin_user_id: adminUser.id,
        p_admin_email: adminUser.email!,
        p_reason: `계정 생성 실패: ${authError.message}`,
      });
      return NextResponse.json({ error: `계정 생성 실패: ${authError.message}` }, { status: 500 });
    }
    authUserId = authData.user.id;
    const { data: recordData, error: recordError } = await svc.rpc("admin_record_child_approval_auth_created", {
      p_request_id: id,
      p_auth_user_id: authUserId,
    });
    if (recordError || !recordData?.[0]?.success) {
      await svc.auth.admin.deleteUser(authUserId);
      await svc.rpc("admin_finalize_child_approval_failure", {
        p_request_id: id,
        p_admin_user_id: adminUser.id,
        p_admin_email: adminUser.email!,
        p_reason: "생성된 계정 연결 정보를 저장하지 못했습니다.",
      });
      return NextResponse.json({ error: "계정 연결 정보를 저장하지 못했습니다." }, { status: 500 });
    }
  }

  // 3. family_members -> member_accounts -> child_profiles (실패 시 앞 단계만 보상 삭제, auth는 유지)
  const { data: familyMember, error: fmError } = await svc
    .from("family_members")
    .insert({ family_id: familyId, user_id: authUserId, role: "child" })
    .select("id")
    .single();
  if (fmError) {
    await svc.rpc("admin_finalize_child_approval_failure", {
      p_request_id: id,
      p_admin_user_id: adminUser.id,
      p_admin_email: adminUser.email!,
      p_reason: `가족 등록 실패: ${fmError.message}`,
    });
    return NextResponse.json({ error: `가족 등록 실패: ${fmError.message}` }, { status: 500 });
  }

  const { error: accError } = await svc.from("member_accounts").insert({
    id: authUserId,
    username: claim.username,
    email: null,
    display_name: name,
    family_id: familyId,
    role: "child",
    created_by: adminUser.id,
    must_change_password: true,
  });
  if (accError) {
    await svc.from("family_members").delete().eq("id", familyMember.id);
    await svc.rpc("admin_finalize_child_approval_failure", {
      p_request_id: id,
      p_admin_user_id: adminUser.id,
      p_admin_email: adminUser.email!,
      p_reason: `계정 정보 저장 실패: ${accError.message}`,
    });
    return NextResponse.json({ error: `계정 정보 저장 실패: ${accError.message}` }, { status: 500 });
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
      tier: 2, // Care Insight 고정
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
      p_request_id: id,
      p_admin_user_id: adminUser.id,
      p_admin_email: adminUser.email!,
      p_reason: `아이 프로필 생성 실패: ${childErr.message}`,
    });
    return NextResponse.json({ error: `아이 프로필 생성 실패: ${childErr.message}` }, { status: 500 });
  }

  // 4. 승인 확정
  const { data: finalizeData, error: finalizeError } = await svc.rpc("admin_finalize_child_approval_success", {
    p_request_id: id,
    p_admin_user_id: adminUser.id,
    p_admin_email: adminUser.email!,
    p_child_id: child.id,
  });

  if (finalizeError || !finalizeData?.[0]?.success) {
    console.error("[child-approval-requests/approve] finalize error:", finalizeError, finalizeData);
    await svc.from("child_profiles").delete().eq("id", child.id);
    await svc.from("member_accounts").delete().eq("id", authUserId);
    await svc.from("family_members").delete().eq("id", familyMember.id);
    await svc.rpc("admin_finalize_child_approval_failure", {
      p_request_id: id,
      p_admin_user_id: adminUser.id,
      p_admin_email: adminUser.email!,
      p_reason: "승인 확정 처리에 실패했습니다.",
    });
    return NextResponse.json({ error: "승인 확정 처리에 실패했습니다" }, { status: 500 });
  }

  return NextResponse.json({ success: true, childId: child.id });
}
