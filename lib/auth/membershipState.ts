import { createServiceClient } from "@/lib/supabase/server";

export type MembershipState =
  | "RESTOREABLE_WITHDRAWN"    // 1. 복구 가능 탈퇴 계정 (탈퇴 후 30일 이내)
  | "SUSPENDED"                // 2. 관리자 정지 계정
  | "DELETED"                  // 2. 영구 파기 / 30일 초과 만료 계정
  | "ACTIVE_PARENT"            // 3. 활성 기존 보호자 계정
  | "ACTIVE_CHILD"             // 3. 활성 기존 아이 계정
  | "AUTHENTICATED_INCOMPLETE" // 4. 회원가입 진행 중 미완료 계정
  | "GUEST";                   // 5. 신규 방문자 / 세션 없음

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
 * 라우팅 우선순위 (요청서 엄수):
 * 1. 복구 가능 탈퇴 계정 (RESTOREABLE_WITHDRAWN) -> 30일 이내 탈퇴 계정은 /signup이 아닌 /account/withdrawn으로 라우팅
 * 2. 정지·영구 삭제 계정 (SUSPENDED / DELETED) -> 차단 또는 세션 종료
 * 3. 활성 기존 계정 (ACTIVE_PARENT / ACTIVE_CHILD) -> 대시보드 홈 진입
 * 4. 가입 미완료 계정 (AUTHENTICATED_INCOMPLETE) -> /signup (resume step)
 * 5. 신규 계정 (GUEST)
 */
export async function resolveMembershipState(userId: string): Promise<MembershipResult> {
  const svc = createServiceClient();

  const [parentRes, memberRes] = await Promise.all([
    svc
      .from("parents")
      .select("account_status, withdrawn_at, purge_scheduled_at, onboarding_completed_at")
      .eq("id", userId)
      .maybeSingle(),
    svc
      .from("family_members")
      .select("id, family_id, role, deleted_at")
      .eq("user_id", userId)
      .is("deleted_at", null),
  ]);

  const parent = parentRes.data as {
    account_status: string;
    withdrawn_at: string | null;
    purge_scheduled_at: string | null;
    onboarding_completed_at: string | null;
  } | null;

  // ── 1순위 & 2순위: 탈퇴 / 정지 / 삭제 상태 우선 판정 ─────────────────────
  if (parent) {
    const isWithdrawnStatus =
      parent.account_status === "WITHDRAWN_PENDING" ||
      parent.account_status === "RESTORE_REQUESTED" ||
      parent.account_status === "WITHDRAWN";

    if (isWithdrawnStatus || parent.withdrawn_at) {
      const now = new Date();
      let purgeDate: Date | null = null;
      if (parent.purge_scheduled_at) {
        purgeDate = new Date(parent.purge_scheduled_at);
      } else if (parent.withdrawn_at) {
        purgeDate = new Date(new Date(parent.withdrawn_at).getTime() + 30 * 24 * 60 * 60 * 1000);
      }

      // 탈퇴 30일 이내인 경우 -> 복구 가능 탈퇴 계정으로 판정 (가족/아이 존재여부보다 우선)
      if (purgeDate && now < purgeDate) {
        return { state: "RESTOREABLE_WITHDRAWN" };
      } else {
        // 30일 초과 만료 계정 -> 파기(DELETED) 처리
        return { state: "DELETED" };
      }
    }

    if (parent.account_status === "PURGED") {
      return { state: "DELETED" };
    }
    if (parent.account_status === "SUSPENDED") {
      return { state: "SUSPENDED" };
    }
  }

  // ── 3순위: 활성 기존 아이 계정 ──────────────────────────────────────────
  const members = (memberRes.data ?? []) as { id: string; family_id: string; role: string }[];
  const childMembership = members.find((m) => m.role === "child");
  if (childMembership) {
    return { state: "ACTIVE_CHILD", familyId: childMembership.family_id, role: "child" };
  }

  // ── 3순위/4순위: 가입 상태 및 미완료 단계 판정 ─────────────────────────
  const parentMembership = members.find(
    (m) => m.role === "owner_parent" || m.role === "parent"
  );
  const familyId = parentMembership?.family_id ?? null;

  const onboardingStep = await resolveIncompleteStep(svc, userId, familyId);

  // 약관, 프로필, 가족 생성, 아이 등록 중 미완료 단계가 존재하는 경우
  if (onboardingStep !== "complete") {
    return {
      state: "AUTHENTICATED_INCOMPLETE",
      onboardingStep: onboardingStep as OnboardingStep,
      familyId: familyId ?? undefined,
    };
  }

  // 모든 온보딩 완료 (가족+활성 아이 존재) -> ACTIVE_PARENT
  return {
    state: "ACTIVE_PARENT",
    familyId: familyId!,
    role: parentMembership!.role,
  };
}

async function resolveIncompleteStep(
  svc: ReturnType<typeof createServiceClient>,
  userId: string,
  familyId: string | null
): Promise<OnboardingStep | "complete"> {
  // 1. 약관 동의 확인
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

  // 2. 보호자 정보 (전화번호) 확인
  const { data: parentRow } = await svc
    .from("parents")
    .select("phone_number, onboarding_completed_at")
    .eq("id", userId)
    .maybeSingle();
  if (!(parentRow as { phone_number?: string | null } | null)?.phone_number) return "profile";

  // 3. 가족 생성/소속 확인
  if (!familyId) return "family";

  // 4. 아이 등록 및 활성 아이 존재 확인 (child_profiles에는 deleted_at 컬럼 없음)
  const { count: childCount } = await svc
    .from("child_profiles")
    .select("id", { count: "exact" })
    .eq("family_id", familyId);

  if (!childCount) return "child";

  return "complete";
}
