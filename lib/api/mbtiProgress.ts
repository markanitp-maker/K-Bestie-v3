/**
 * 케이 놀이: MBTI — 진행 상태 저장(POST /api/mbti/progress) API 계약 (US-011)
 *
 * 참고: SPEC.md §2.1(5)/§4("진행 상태 저장에 순번/버전 포함, 오래된 요청이 최신 덮어쓰기
 * 방지")/§7, `.omc/artifacts/backend-design-us004.md`, `components/mbti/QuestionScreen.tsx`의
 * `MbtiProgressSaveEvent`.
 *
 * `k_play_sessions.progress_state`는 애플리케이션이 정의하는 JSONB 컬럼이다(DB 제약 없음).
 * 이 파일이 그 shape과 검증 로직의 단일 정의처다 — 저장(POST 라우트)과 조회(GET 세션 라우트)
 * 양쪽에서 재사용한다.
 */

import type { MbtiAnswer } from "@/lib/mbti/scoreResult";

/** `k_play_sessions.progress_state`에 저장되는 값의 shape (애플리케이션 정의). */
export interface MbtiProgressState {
  /** 마지막으로 답변을 완료한 문항의 노출 순서(1~16, `Question.order`와 동일값). */
  questionIndex: number;
  /** 지금까지 수집된 답변 전체(제출 순서 = 문항 순서). */
  answers: readonly MbtiAnswer[];
  /** 단조 증가 저장 버전. 오래된(더 작거나 같은) 요청이 최신 상태를 덮어쓰지 못하도록 서버가 이 값으로 가드한다. */
  progressVersion: number;
  /** 서버가 이 진행 상태를 기록한 시각(ISO 8601). */
  savedAt: string;
}

export interface SaveMbtiProgressRequestBody {
  sessionId: string;
  questionIndex: number;
  answers: readonly MbtiAnswer[];
  progressVersion: number;
}

export interface SaveMbtiProgressResponse {
  /** 이 요청의 진행 상태가 실제로 저장되었는지. false면 서버가 더 최신인 저장값을 보존하기 위해
   * 이 요청을 무시했다는 뜻(오류 아님 — 오래된 요청이거나 동시 쓰기에서 밀린 경우). */
  applied: boolean;
  /** 'ok' | 'stale_progress_version' | 'progress_version_conflict' */
  reason: string;
}

export interface SaveMbtiProgressErrorPayload {
  reason: string;
  message?: string;
}

/** 저장 API 호출이 실패했을 때(HTTP 오류 응답, 4xx/5xx) 던지는 오류. */
export class SaveMbtiProgressRequestError extends Error {
  readonly reason: string;

  constructor(payload: SaveMbtiProgressErrorPayload) {
    super(payload.message ?? payload.reason);
    this.name = "SaveMbtiProgressRequestError";
    this.reason = payload.reason;
  }
}

function isMbtiAnswer(value: unknown): value is MbtiAnswer {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.questionId === "string" && typeof candidate.selectedPole === "string";
}

/** `answers` 필드(요청 바디 또는 저장된 progress_state 양쪽)를 공통 검증한다. */
export function parseMbtiAnswers(value: unknown): readonly MbtiAnswer[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.every(isMbtiAnswer) ? (value as MbtiAnswer[]) : null;
}

/**
 * `k_play_sessions.progress_state`에서 읽어온 원시 JSONB 값을 안전하게 파싱한다.
 * DB 레벨 제약이 없는 애플리케이션 정의 컬럼이므로, shape이 어긋나면(빈 값/구버전/손상) 예외를
 * 던지지 않고 null을 반환해 호출부가 "저장된 진행 없음"으로 방어적으로 처리하게 한다.
 */
export function parseMbtiProgressState(value: unknown): MbtiProgressState | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const answers = parseMbtiAnswers(candidate.answers);
  if (
    typeof candidate.questionIndex !== "number" ||
    answers === null ||
    typeof candidate.progressVersion !== "number" ||
    typeof candidate.savedAt !== "string"
  ) {
    return null;
  }
  return {
    questionIndex: candidate.questionIndex,
    answers,
    progressVersion: candidate.progressVersion,
    savedAt: candidate.savedAt,
  };
}

const MBTI_PROGRESS_ENDPOINT = "/api/mbti/progress";

function isSaveMbtiProgressResponse(value: unknown): value is SaveMbtiProgressResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.applied === "boolean" && typeof candidate.reason === "string";
}

/**
 * 진행 상태를 서버에 저장한다.
 *
 * ⚠️ 호출부 계약: 이 함수는 fire-and-forget 호출을 전제로 한다(SPEC.md §2.1(5)). 이 Promise가
 * reject되어도 문항 진행(다음 문항 이동)을 막아서는 안 된다 — 호출부는 `.catch()`로 로깅만 하고
 * UI 흐름을 계속 진행해야 한다.
 */
export async function saveMbtiProgress(
  request: SaveMbtiProgressRequestBody,
): Promise<SaveMbtiProgressResponse> {
  const response = await fetch(MBTI_PROGRESS_ENDPOINT, {
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
      throw new SaveMbtiProgressRequestError(payload as SaveMbtiProgressErrorPayload);
    }
    throw new SaveMbtiProgressRequestError({ reason: "unknown_error" });
  }

  if (!isSaveMbtiProgressResponse(payload)) {
    throw new SaveMbtiProgressRequestError({ reason: "invalid_response_shape" });
  }

  return payload;
}
