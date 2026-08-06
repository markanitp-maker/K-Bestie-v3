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
 * 판정 기준:
 * - account_status: PURGED/SUSPENDED → 즉시 차단.
 *   ACTIVE/RESTORED 상태여야만 ACTIVE_PARENT로 반환한다.
 *   AUTHENTICATED_INCOMPLETE/ONBOARDING 상태는 구조적 데이터(family+child)가
 *   있어도 온보딩 단계로 라우팅 — 상태 머신 우회 방지.
 * - family_members/child_profiles 구조적 완결성(가족 소속 + 아이 최소 1명)을 추가로 검증.
 * - onboarding_completed_at: 신규 계정은 최종 단계(아이 등록 + 승인)에서만 채워진다.
 *   기존 계정(마이그레이션 이전 생성)은 NULL이므로 ACTIVE_PARENT 판정에서 제외하지 않는다
 *   (역호환성). 추후 강제 검증이 필요하면 아래 TODO 지점을 활성화한다.
 *
 * signup_consents 존재 여부는 상태 게이트에 사용하지 않는다 — 기존 사용자는 이 테이블에
 * 아무 행도 없으므로, 존재 여부로 게이트를 걸면 기존 활성 보호자가 회원가입 화면으로
 * 튕겨나가는 회귀가 발생한다. signup_consents는 resume 지점 계산(onboardingStep)에서만 참고.
 */
export async function resolveMembershipState(userId: string): Promise<MembershipResult> {
  const svc = createServiceClient();

  const [parentRes, memberRes] = await Promise.all([
    svc
      .from("parents")
      .select("account_status, onboarding_completed_at")
      .eq("id", userId)
      .maybeSingle(),
    svc
      .from("family_members")
      .select("id, family_id, role")
      .eq("user_id", userId)
      .is("deleted_at", null),
  ]);

  const parent = parentRes.data as {
    account_status: string;
    onboarding_completed_at: string | null;
  } | null;

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

  // ── ONBOARDING/AUTHENTICATED_INCOMPLETE: 구조 완결이어도 온보딩 단계로 라우팅 ──
  // 상태 머신 우회 방지: 가족+아이가 있어도 공식 account_status 전이가 완료되지 않으면
  // onboarding step으로 보낸다.
  const INCOMPLETE_STATUSES = ["AUTHENTICATED_INCOMPLETE", "ONBOARDING"];
  if (parent && INCOMPLETE_STATUSES.includes(parent.account_status)) {
    const parentMemberForStep = members.find(
      (m) => m.role === "owner_parent" || m.role === "parent"
    );
    const onboardingStep = await resolveIncompleteStep(
      svc,
      userId,
      parentMemberForStep?.family_id ?? null
    );
    return { state: "AUTHENTICATED_INCOMPLETE", onboardingStep };
  }

  // ── ACTIVE/RESTORED: 구조적 완결성 검증 ─────────────────────────────────────
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

  // TODO(strict): 신규 계정 전용 강화 검증 — onboarding_completed_at이 NULL이고
  // ACTIVE_PARENT인 경우 별도 조치가 필요하면 아래를 활성화한다.
  // if (!parent?.onboarding_completed_at) { ... }

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
