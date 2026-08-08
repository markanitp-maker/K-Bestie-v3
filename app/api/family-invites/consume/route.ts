import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { FAMILY_INVITE_COOKIE, credentialHash, decodeInviteContext } from "@/lib/familyInvites/oneTimeInvite";
import { resolveMembershipState } from "@/lib/auth/membershipState";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const membership = await resolveMembershipState(user.id).catch(() => null);
  if (!membership) {
    return NextResponse.json({ error: "가입 상태를 확인하지 못했습니다." }, { status: 500 });
  }
  if (
    membership.state === "AUTHENTICATED_INCOMPLETE"
    && (membership.onboardingStep === "consent" || membership.onboardingStep === "profile")
  ) {
    return NextResponse.json({
      error: "가족 참여 전에 약관 동의와 보호자 기본정보를 완료해 주세요.",
      reason: "onboarding_incomplete",
      onboardingStep: membership.onboardingStep,
    }, { status: 428 });
  }
  if (["RESTOREABLE_WITHDRAWN", "SUSPENDED", "DELETED", "ACTIVE_CHILD"].includes(membership.state)) {
    return NextResponse.json({
      error: membership.state === "ACTIVE_CHILD"
        ? "아이 계정으로는 보호자 초대를 사용할 수 없습니다."
        : "현재 계정 상태에서는 가족 초대를 사용할 수 없습니다.",
      reason: membership.state === "ACTIVE_CHILD" ? "account_role_conflict" : "account_not_eligible",
    }, { status: 409 });
  }
  const cookieStore = await cookies();
  const context = decodeInviteContext(cookieStore.get(FAMILY_INVITE_COOKIE)?.value);
  const hash = context ? credentialHash(context) : null;
  if (!hash) return NextResponse.json({ error: "초대 정보가 없습니다." }, { status: 404 });

  const service = createServiceClient();
  const { data, error } = await service.rpc("consume_one_time_family_invite", {
    p_credential_hash: hash,
    p_user_id: user.id,
  });
  if (error) return NextResponse.json({ error: "가족 참여 처리에 실패했습니다." }, { status: 500 });
  const result = data?.[0] as { success: boolean; reason: string; joined_family_id: string | null } | undefined;
  if (!result) return NextResponse.json({ error: "가족 참여 결과를 확인하지 못했습니다." }, { status: 500 });

  const statusByReason: Record<string, number> = {
    not_found: 404, invalid_credential: 404, consumed: 409, revoked: 410, expired: 410,
    already_processed: 409, self_invite: 400, family_not_found: 404,
    existing_family_conflict: 409, capacity_full: 409, account_role_conflict: 409,
    account_not_eligible: 409, account_restore_required: 409, onboarding_incomplete: 428,
  };
  const messageByReason: Record<string, string> = {
    not_found: "유효하지 않은 초대 링크입니다.",
    invalid_credential: "유효하지 않은 초대 링크입니다.",
    consumed: "이미 사용된 초대 링크입니다. 새로운 초대를 받아 주세요.",
    revoked: "취소된 초대 링크입니다.",
    expired: "이 초대 링크는 만료되었습니다.",
    already_processed: "이미 처리된 초대 링크입니다.",
    self_invite: "본인이 만든 초대 링크는 사용할 수 없습니다.",
    family_not_found: "초대한 가족을 찾을 수 없습니다.",
    existing_family_conflict: "이미 다른 가족에 소속되어 있어 자동으로 참여할 수 없습니다.",
    capacity_full: "가족 보호자 정원이 이미 가득 찼습니다.",
    account_role_conflict: "아이 계정으로는 보호자 초대를 사용할 수 없습니다.",
    account_not_eligible: "현재 계정 상태에서는 가족 초대를 사용할 수 없습니다.",
    account_restore_required: "기존 계정을 먼저 복구한 뒤 가족 초대를 사용해 주세요.",
    onboarding_incomplete: "가족 참여 전에 약관 동의와 보호자 기본정보를 완료해 주세요.",
  };
  if (!result.success) {
    const response = NextResponse.json(
      { error: messageByReason[result.reason] || "가족 참여에 실패했습니다.", reason: result.reason },
      { status: statusByReason[result.reason] || 409 },
    );
    if (["consumed", "revoked", "expired", "not_found", "invalid_credential"].includes(result.reason)) {
      response.cookies.delete(FAMILY_INVITE_COOKIE);
    }
    return response;
  }

  const response = NextResponse.json({
    ok: true,
    familyId: result.joined_family_id,
    alreadyMember: result.reason === "already_member",
  });
  response.cookies.delete(FAMILY_INVITE_COOKIE);
  return response;
}
