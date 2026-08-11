import type { SupabaseClient } from "@supabase/supabase-js";
import { toAuthEmail } from "@/lib/plan/childAuthEmail";

// autoApproveChildRequest.ts(BETA 자동승인)와 admin/child-approval-requests/[id]/approve/
// route.ts(PAID 수동승인) 양쪽에서 공유하는 계정 생성 단계 전용 헬퍼다. 두 파일 자체는
// (동시 작업 충돌 회피를 위해) 의도적으로 분리된 상태를 유지하지만, "auth.admin.createUser
// 중복 오류를 사용자용 코드로 바꾸고 고아 계정이면 정리 후 1회 재시도한다"는 이 좁은 로직만은
// 정확히 동일해야 하므로 여기서만 공유한다.
export const CHILD_LOGIN_ID_ALREADY_EXISTS = "CHILD_LOGIN_ID_ALREADY_EXISTS";
export const CHILD_ACCOUNT_CREATE_FAILED = "CHILD_ACCOUNT_CREATE_FAILED";

const DUPLICATE_EMAIL_PATTERNS = [
  "already been registered",
  "already registered",
  "email_exists",
  "user_already_exists",
];

function isDuplicateEmailError(message: string | undefined | null): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return DUPLICATE_EMAIL_PATTERNS.some((p) => lower.includes(p));
}

export type CreateChildAuthAccountResult =
  | { ok: true; authUserId: string }
  | { ok: false; errorCode: string; internalReason: string };

/**
 * 아이 로그인 계정(Auth)을 생성한다. Supabase Auth가 "이미 등록된 이메일" 오류를 반환하면
 * admin_check_child_auth_orphan RPC로 그 내부 이메일이 실사용 중인지 고아 상태인지 판정한다.
 * - 실사용 중이면 CHILD_LOGIN_ID_ALREADY_EXISTS를 반환한다(Supabase 원문은 절대 밖으로 내지 않음).
 * - 고아면 해당 Auth 계정만 안전하게 삭제한 뒤 동일 요청으로 딱 1회 재시도한다.
 */
export async function createChildAuthAccountWithOrphanRecovery(
  svc: SupabaseClient,
  params: { username: string; password: string; name: string }
): Promise<CreateChildAuthAccountResult> {
  const email = toAuthEmail(params.username);
  const attemptCreate = () =>
    svc.auth.admin.createUser({
      email,
      password: params.password,
      email_confirm: true,
      user_metadata: { name: params.name, username: params.username, is_member_account: true },
    });

  let { data: authData, error: authError } = await attemptCreate();

  if (authError && isDuplicateEmailError(authError.message)) {
    const { data: orphanRows, error: orphanCheckError } = await svc.rpc(
      "admin_check_child_auth_orphan",
      { p_email: email }
    );
    const orphan = Array.isArray(orphanRows) ? orphanRows[0] : orphanRows;

    if (orphanCheckError) {
      return {
        ok: false,
        errorCode: CHILD_ACCOUNT_CREATE_FAILED,
        internalReason: `고아 계정 판정 실패: ${orphanCheckError.message}`,
      };
    }

    if (!orphan?.is_orphan) {
      // orphan.auth_user_id가 없으면(=해당 이메일의 Auth 계정을 못 찾음) 실사용 여부를 알 수
      // 없는 상태이므로, 안전하게 "실사용 중"과 동일하게 취급해 원문 노출 없이 반려한다.
      return {
        ok: false,
        errorCode: CHILD_LOGIN_ID_ALREADY_EXISTS,
        internalReason: `아이디 중복(실사용 계정 또는 판정 불가): ${authError.message}`,
      };
    }

    const { error: deleteError } = await svc.auth.admin.deleteUser(orphan.auth_user_id);
    if (deleteError) {
      return {
        ok: false,
        errorCode: CHILD_ACCOUNT_CREATE_FAILED,
        internalReason: `고아 계정 삭제 실패: ${deleteError.message}`,
      };
    }

    ({ data: authData, error: authError } = await attemptCreate());
  }

  if (authError || !authData?.user) {
    return {
      ok: false,
      errorCode: isDuplicateEmailError(authError?.message)
        ? CHILD_LOGIN_ID_ALREADY_EXISTS
        : CHILD_ACCOUNT_CREATE_FAILED,
      internalReason: `계정 생성 실패: ${authError?.message ?? "unknown"}`,
    };
  }

  return { ok: true, authUserId: authData.user.id };
}

/**
 * 이번 호출에서 새로 만든(authUserNewlyCreated) Auth 계정을 후속 단계 실패로 되돌릴 때
 * 쓰는 보상 삭제 헬퍼. 단순히 auth.admin.deleteUser만 부르는 게 아니라, 삭제가 실제로
 * 성공했을 때만 child_approval_requests.created_auth_user_id를 함께 NULL로 되돌린다 —
 * 그러지 않으면 이 요청이 나중에(관리자 재승인 등으로) 다시 claim될 때 이미 삭제된
 * UUID를 "기존 계정이라 재사용 가능"으로 오인해 계정 생성을 건너뛰고 이후 모든 단계가
 * 계속 실패한다(2026-08-11 게이트① 지적). deleteUser 자체가 실패하면 계정이 실제로는
 * 아직 남아있는 것이므로 포인터를 지우지 않고 그대로 유지해 안전하게 재사용 가능한
 * 상태를 보존한다.
 */
export async function cleanupNewlyCreatedChildAuthAccount(
  svc: SupabaseClient,
  requestId: string,
  authUserId: string
): Promise<void> {
  const { error: deleteError } = await svc.auth.admin.deleteUser(authUserId);
  if (deleteError) {
    console.error(
      `[cleanupNewlyCreatedChildAuthAccount] deleteUser 실패 (request=${requestId}, authUserId=${authUserId}):`,
      deleteError.message
    );
    return;
  }
  const { error: clearPointerError } = await svc
    .from("child_approval_requests")
    .update({ created_auth_user_id: null })
    .eq("id", requestId)
    .eq("created_auth_user_id", authUserId);
  if (clearPointerError) {
    console.error(
      `[cleanupNewlyCreatedChildAuthAccount] created_auth_user_id 초기화 실패 (request=${requestId}):`,
      clearPointerError.message
    );
  }
}
