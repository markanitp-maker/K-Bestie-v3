/**
 * 게임 참여: MBTI — 세션 완료 처리(POST /api/mbti/complete) API 계약 (US-008B)
 *
 * 참고: SPEC.md §2.1(6)("16문항 완료 → 점수 합산 → 유형 확정 → 결과 화면, completed_at 저장")/
 * §7("미완료를 완료 처리 금지"), `app/api/mbti/progress/route.ts`(동일 인증/세션 조회 패턴 재사용),
 * `lib/api/mbtiProgress.ts`(answers shape 검증기 `parseMbtiAnswers` 재사용).
 *
 * 이 API는 US-011의 진행 저장(POST /api/mbti/progress)과 달리 numeric progressVersion CAS를
 * 쓰지 않는다 — 상태 전이 자체(`status='in_progress'` → `'completed'`)가 이 API의 compare-and-swap
 * 키다(두 요청이 동시에 완료를 시도해도 `k_play_sessions.status='in_progress'` 조건에 매치되는
 * UPDATE는 둘 중 하나에서만 성공한다).
 */

import type { MbtiType } from "@/lib/data/mbtiTypes";
import type { MbtiAnswer } from "@/lib/mbti/scoreResult";

const MBTI_COMPLETE_ENDPOINT = "/api/mbti/complete";

export interface CompleteMbtiSessionRequestBody {
  sessionId: string;
  mbtiType: MbtiType;
  answers: readonly MbtiAnswer[];
}

export interface CompleteMbtiSessionResponse {
  /** 이 세션이 (이 요청으로든, 방금 경합에서 이긴 다른 요청으로든) 완료 상태임을 뜻한다.
   * 200 응답이면 항상 true — 실패는 4xx/5xx 오류 응답으로만 표현한다. */
  completed: true;
  /** 'ok'(이 요청이 실제로 완료 처리함) | 'already_completed'(경합에서 져서 다른 요청이
   * 먼저 완료 처리했지만, 최종 상태는 동일하므로 오류가 아니라 idempotent 성공으로 취급). */
  reason: "ok" | "already_completed";
}

export interface CompleteMbtiSessionErrorPayload {
  reason: string;
  message?: string;
}

/** 완료 처리 API 호출이 실패했을 때(HTTP 오류 응답, 4xx/5xx) 던지는 오류. */
export class CompleteMbtiSessionRequestError extends Error {
  readonly reason: string;

  constructor(payload: CompleteMbtiSessionErrorPayload) {
    super(payload.message ?? payload.reason);
    this.name = "CompleteMbtiSessionRequestError";
    this.reason = payload.reason;
  }
}

function isCompleteMbtiSessionResponse(value: unknown): value is CompleteMbtiSessionResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.completed === true &&
    (candidate.reason === "ok" || candidate.reason === "already_completed")
  );
}

/**
 * 세션 완료를 서버에 알린다(최종 MBTI 유형 + 답변을 `progress_state`에 함께 기록, `completed_at`
 * 저장).
 *
 * ⚠️ 호출부 계약: 이 함수는 fire-and-forget 호출을 전제로 한다(SPEC.md §2.1(6),
 * `saveMbtiProgress`와 동일 패턴). 이 Promise가 reject되어도 결과 화면(S4→S5) 전환을 막아서는
 * 안 된다 — 호출부는 `.catch()`로 로깅만 하고 UI 흐름을 계속 진행해야 한다.
 */
export async function completeMbtiSession(
  request: CompleteMbtiSessionRequestBody,
): Promise<CompleteMbtiSessionResponse> {
  const response = await fetch(MBTI_COMPLETE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (
      typeof payload === "object" &&
      payload !== null &&
      typeof (payload as Record<string, unknown>).reason === "string"
    ) {
      throw new CompleteMbtiSessionRequestError(payload as CompleteMbtiSessionErrorPayload);
    }
    throw new CompleteMbtiSessionRequestError({ reason: "unknown_error" });
  }

  if (!isCompleteMbtiSessionResponse(payload)) {
    throw new CompleteMbtiSessionRequestError({ reason: "invalid_response_shape" });
  }

  return payload;
}
