import { createServiceClient } from "@/lib/supabase/server";

export type MembershipState =
  | "AUTHENTICATED_INCOMPLETE"
  | "ACTIVE_PARENT"
  | "ACTIVE_CHILD"
  | "SUSPENDED"
  | "DELETED";

export type OnboardingStep = "consent" | "profile" | "family" | "child";

export interface MembershipResult {
  state: MembershipState;
  onboardingStep?: OnboardingStep;
  familyId?: string;
  childId?: string;
  role?: string;
}

/**
 * 서버 검증된 auth 사용자(userId)의 회원가입/멤버십 상태를 판정한다.
 *
 * 판정 기준은 family_members/child_profiles의 "구조적 완결성"(가족 소속 + 아이 최소 1명)
 * 뿐이다 — signup_consents(신규 동의 감사 테이블) 존재 여부는 상태 게이트에 절대 쓰지
 * 않는다. 기존 실사용자는 이 테이블에 아무 행도 없으므로, 존재 여부로 게이트를 걸면
 * 기존 활성 보호자가 전부 AUTHENTICATED_INCOMPLETE로 오분류되어 회원가입 화면으로
 * 튕겨나가는 회귀가 생긴다(요청서 §9 "기존 사용자와 가족을 삭제한 뒤 재생성하는 방식
 * 금지"/§13.3 "기존 보호자... 회원가입 페이지가 표시되지 않음"과 정면 충돌).
 * signup_consents는 신규 가입 마법사가 통과 시점에 채우는 감사 기록 전용이며, resume 지점
 * 계산(onboardingStep)에서만 참고한다 — 그마저도 이미 AUTHENTICATED_INCOMPLETE로 판정된
 * 사용자에게만 영향을 준다(ACTIVE_PARENT/ACTIVE_CHILD 분기는 이 테이블을 아예 조회하지 않음).
 */
export async function resolveMembershipState(userId: string): Promise<MembershipResult> {
  const svc = createServiceClient();

  const [parentRes, memberRes] = await Promise.all([
    svc
      .from("parents")
      .select("account_status")
      .eq("id", userId)
      .maybeSingle(),
    svc
      .from("family_members")
      .select("id, family_id, role")
      .eq("user_id", userId)
      .is("deleted_at", null),
  ]);

  const parent = parentRes.data as { account_status: string } | null;
  if (parent) {
    if (parent.account_status === "PURGED") {
      return { state: "DELETED" };
    }
    if (parent.account_status === "SUSPENDED") {
      return { state: "SUSPENDED" };
    }
    // WITHDRAWN_PENDING/RESTORE_REQUESTED는 middleware.ts가 /parent/* 접근 시 이미
    // /account/withdrawn으로 리다이렉트한다 — 여기서 중복 처리하지 않고 그대로 통과시킨다
    // (루트 페이지 라우팅과 미들웨어 두 곳에서 서로 다른 목적지로 보내면 더 혼란스럽다).
  }

  const members = (memberRes.data ?? []) as { id: string; family_id: string; role: string }[];

  const childMembership = members.find((m) => m.role === "child");
  if (childMembership) {
    return { state: "ACTIVE_CHILD", familyId: childMembership.family_id, role: "child" };
  }

  const parentMembership = members.find((m) => m.role === "owner_parent" || m.role === "parent");
  if (!parentMembership) {
    const onboardingStep = await resolveIncompleteStep(svc, userId, null);
    return { state: "AUTHENTICATED_INCOMPLETE", onboardingStep };
  }

  const { count: childCount } = await svc
    .from("child_profiles")
    .select("id", { count: "exact", head: true })
    .eq("family_id", parentMembership.family_id);

  if (!childCount) {
    return {
      state: "AUTHENTICATED_INCOMPLETE",
      onboardingStep: "child",
      familyId: parentMembership.family_id,
    };
  }

  return { state: "ACTIVE_PARENT", familyId: parentMembership.family_id, role: parentMembership.role };
}

async function resolveIncompleteStep(
  svc: ReturnType<typeof createServiceClient>,
  userId: string,
  familyId: string | null
): Promise<OnboardingStep> {
  const { data: consent } = await svc
    .from("signup_consents")
    .select("id")
    .eq("user_id", userId)
    .eq("consent_type", "service_terms")
    .eq("agreed", true)
    .is("withdrawn_at", null)
    .limit(1)
    .maybeSingle();
  if (!consent) return "consent";

  const { data: parentRow } = await svc
    .from("parents")
    .select("phone_number")
    .eq("id", userId)
    .maybeSingle();
  if (!(parentRow as { phone_number?: string | null } | null)?.phone_number) return "profile";

  if (!familyId) return "family";
  return "child";
}
