import type { NextResponse } from "next/server";

/**
 * @deprecated 053부터 부모 계정 단위 베타 승인은 폐지됐다.
 *
 * 신규 아이는 관리자 승인 성공 전까지 인증 계정과 child_profiles가 생성되지
 * 않으므로, 실제 생성된 아이에게 부모의 과거 approval_status를 다시 검사하면
 * 안 된다. 각 API의 인증·가족 접근 권한과 법정대리인 동의 검사는 기존
 * requireChildAccess/consentGuard가 계속 담당한다.
 *
 * 기존 호출부의 대규모 수정으로 인한 긴급 배포 회귀를 피하기 위해 호환 함수는
 * 유지하되 언제나 통과시킨다.
 */
export async function checkApprovalForChild(
  _childId: string
): Promise<NextResponse | null> {
  return null;
}

/**
 * @deprecated 부모 계정 단위 승인 폐지. checkApprovalForChild 설명 참조.
 */
export async function checkApprovalForSession(
  _sessionId: string
): Promise<NextResponse | null> {
  return null;
}
