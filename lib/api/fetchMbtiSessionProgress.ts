/**
 * 케이 놀이: MBTI — 세션 진행 상태 재수화(rehydration) 조회 계약
 *
 * ── 아키텍처 변경(2026-07 대표 지시) ──────────────────────────────────────────
 * 이 모듈은 더 이상 "이 자녀에게 이어하기 가능한 세션이 있는가?"(S1/S2 분기)를 스스로
 * 판단하지 않는다. 그 결정은 전적으로 메인 앱이 내리고, `MBTI_INIT`의 `startMode`
 * ("new" | "resume")로 이 모듈에 전달한다. 따라서 이 조회의 유일한 목적은
 * `startMode === "resume"`일 때 **이미 핸드오프받은 세션의 저장된 진행 상태를 재수화**
 * 하는 것뿐이다.
 *
 * 요청: `GET /api/mbti/session?sessionId=&childId=`
 *   - `sessionId`: 재수화할 세션(메인 앱이 `MBTI_INIT`으로 넘긴 playSessionId).
 *   - `childId`: 세션 소유 자녀 일치 확인용(서버가 sessionRow.child_id와 대조).
 * 응답: `{ progressState }` (없거나 미완료 상태가 아니면 타입 오류).
 */

import type { MbtiProgressState } from "@/lib/api/mbtiProgress";

/** `GET /api/mbti/session` 성공 응답 shape.
 *
 * 2026-07-25 200문항뱅크 개편으로 이 조회는 더 이상 "진행 있음/없음"만 보고하지 않는다 —
 * 저장된 진행이 없으면(첫 진입) 서버가 이 호출 안에서 20문항을 즉시 선정·고정해 반환하므로,
 * 성공 응답의 `progressState`는 항상 값이 있다(문항이 아직 0개 답변된 상태일 뿐).
 */
export interface FetchMbtiSessionProgressResponse {
  progressState: MbtiProgressState;
}

/** `GET /api/mbti/session` 실패 응답 바디. */
export interface FetchMbtiSessionProgressErrorPayload {
  /** 'invalid_input' | 'unauthorized' | 'forbidden' | 'session_not_found' | 'internal_error' 등 */
  reason: string;
  message?: string;
}

/** 진행 상태 조회 API 호출이 실패했을 때(HTTP 오류 응답) 던지는 오류. */
export class FetchMbtiSessionProgressRequestError extends Error {
  readonly reason: string;

  constructor(payload: FetchMbtiSessionProgressErrorPayload) {
    super(payload.message ?? payload.reason);
    this.name = "FetchMbtiSessionProgressRequestError";
    this.reason = payload.reason;
  }
}

const MBTI_SESSION_ENDPOINT = "/api/mbti/session";

function isFetchMbtiSessionProgressResponse(
  value: unknown,
): value is FetchMbtiSessionProgressResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  // progressState는 MbtiProgressState | null 두 형태만 허용 — 존재 여부만 계약 수준에서
  // 확인하고, 실제 shape 파싱은 서버 라우트가 parseMbtiProgressState로 이미 수행한다.
  return "progressState" in value;
}

/**
 * 이미 핸드오프받은 세션(`sessionId`)의 저장된 진행 상태를 조회한다(이어하기 재수화용).
 * 네트워크/서버 오류나 세션 없음/미완료 시 예외를 던진다 — 호출부가 "무한 로딩 금지"
 * (SPEC.md §7) 원칙에 따라 안전하게 폴백(진행 없음으로 처음부터)하고 오류를 로깅해야 한다.
 */
export async function fetchMbtiSessionProgress(request: {
  sessionId: string;
  childId: string;
}): Promise<FetchMbtiSessionProgressResponse> {
  const query = new URLSearchParams({
    sessionId: request.sessionId,
    childId: request.childId,
  });

  const response = await fetch(`${MBTI_SESSION_ENDPOINT}?${query.toString()}`, {
    method: "GET",
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (
      typeof payload === "object" &&
      payload !== null &&
      typeof (payload as Record<string, unknown>).reason === "string"
    ) {
      throw new FetchMbtiSessionProgressRequestError(
        payload as FetchMbtiSessionProgressErrorPayload,
      );
    }
    throw new FetchMbtiSessionProgressRequestError({ reason: "unknown_error" });
  }

  if (!isFetchMbtiSessionProgressResponse(payload)) {
    throw new FetchMbtiSessionProgressRequestError({ reason: "invalid_response_shape" });
  }

  return payload;
}
