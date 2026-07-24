/**
 * `saveMbtiProgress()`(lib/api/mbtiProgress.ts) 실패를 화면 처리 방식으로 분류한다.
 *
 * SPEC.md §7 공통 원칙 "무한 로딩 금지"/"진행 상태 삭제 금지"에 따라, 진행 저장 실패는
 * 기본적으로 화면 전체를 막지 않는 비차단(non-blocking) 인라인 표시로 처리한다
 * (QuestionScreen.tsx의 저장 배너 — 답변은 그대로 유지되고 문항 이동도 막히지 않는다).
 *
 * 예외적으로 실패 사유가 "세션/인증 자체가 더 이상 유효하지 않음"이면, 계속 답변해도
 * 서버가 매번 거부할 뿐이므로 이때만 전체화면 오류(session_expired/auth_expired)로
 * 전환한다:
 * - `session_not_found` / `session_not_in_progress`(app/api/mbti/progress/route.ts §4 —
 *   완료/만료/취소된 세션에는 진행 저장을 거부) → session_expired
 * - `unauthorized` / `forbidden` → auth_expired
 * - 그 외(입력 오류, 서버 내부 오류, 네트워크/응답 형태 문제 등 일시적 실패) → transient
 */

import { SaveMbtiProgressRequestError } from "../api/mbtiProgress";
import type { MbtiErrorKind } from "./errorKinds";

export type ProgressSaveFailureOutcome =
  /** 비차단 — 답은 로컬에 그대로 유지, 화면은 계속 진행, 인라인 배너만 표시 */
  | { readonly type: "transient" }
  /** 차단 — 세션/인증 자체가 무효화됨, 전체화면 오류로 전환 */
  | { readonly type: "fatal"; readonly kind: MbtiErrorKind };

export function classifyProgressSaveFailure(error: unknown): ProgressSaveFailureOutcome {
  if (!(error instanceof SaveMbtiProgressRequestError)) {
    // 타입이 지정되지 않은 예외 — 세션이 무효화됐다고 단정할 근거가 없으므로 비차단으로
    // 처리한다(과잉 차단이 "무한 로딩 금지" 취지에 어긋남).
    return { type: "transient" };
  }

  switch (error.reason) {
    case "session_not_found":
    case "session_not_in_progress":
      return { type: "fatal", kind: "session_expired" };
    case "unauthorized":
    case "forbidden":
      return { type: "fatal", kind: "auth_expired" };
    case "invalid_input":
    case "internal_error":
    case "invalid_response_shape":
    case "unknown_error":
    default:
      return { type: "transient" };
  }
}
