/**
 * 케이 놀이: MBTI — 진행 상태 저장(POST /api/mbti/progress) API 계약
 * (2026-07-25 200문항뱅크/세션당 20문항 개편, schemaVersion 2)
 *
 * `k_play_sessions.progress_state`는 애플리케이션이 정의하는 JSONB 컬럼이다(DB 제약 없음).
 * 이 파일이 그 shape과 검증 로직의 단일 정의처다 — 세션 생성(GET 세션 라우트가 최초 조회 시
 * 문항 선정까지 함께 수행), 저장(POST 라우트), 완료(complete 라우트) 전부 재사용한다.
 *
 * ── schemaVersion 2와 구버전(16문항) 호환 ────────────────────────────────────────
 * 구버전 progress_state는 `schemaVersion` 필드가 아예 없었다(questionIndex/answers/
 * progressVersion/savedAt만 존재, answers는 `{questionId, selectedPole}` shape).
 * `parseMbtiProgressState`는 `schemaVersion === 2`와 신규 shape(questionOrder/
 * optionOrder/selectedQuestionIds 포함)을 엄격히 요구하므로, 구버전 데이터는 파싱에
 * 실패해 null을 반환한다 — 호출부는 이를 "저장된 진행 없음"과 동일하게 취급해 안전하게
 * 새 20문항 세션으로 다시 시작한다(파괴적 마이그레이션 스크립트 불필요, 낡은 shape은
 * 자연스럽게 무시되고 스키마 버전이 명시적으로 분리된다).
 */

import type { MbtiAnswer } from "@/lib/mbti/scoreResult";
import type { MbtiOptionOrder } from "@/lib/mbti/selectQuestions";

const CURRENT_SCHEMA_VERSION = 2;
const TOTAL_QUESTIONS = 20;

/** `k_play_sessions.progress_state.mbti`에 저장되는 값의 shape (애플리케이션 정의). */
export interface MbtiProgressState {
  /** 스키마 버전. 구버전(버전 필드 없음, 16문항 shape) 데이터와 명시적으로 구분한다. */
  schemaVersion: 2;
  /** 세션 생성 시 단 한 번 고정된 20문항 표시 순서(같은 축 연속 없음). 이후 절대 재계산하지 않는다. */
  questionOrder: readonly string[];
  /** questionOrder와 동일한 20개 id 집합(감사용 별도 저장). */
  selectedQuestionIds: readonly string[];
  /** 문항 ID → 그 문항의 고정 화면 좌우 순서. */
  optionOrder: Readonly<Record<string, MbtiOptionOrder>>;
  /** 마지막으로 답변을 완료한 문항 수(0~20). */
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
  return (
    typeof candidate.questionId === "string" &&
    (candidate.selectedOptionId === "A" || candidate.selectedOptionId === "B")
  );
}

/** `answers` 필드(요청 바디 또는 저장된 progress_state 양쪽)를 공통 검증한다. */
export function parseMbtiAnswers(value: unknown): readonly MbtiAnswer[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.every(isMbtiAnswer) ? (value as MbtiAnswer[]) : null;
}

function isMbtiOptionOrder(value: unknown): value is MbtiOptionOrder {
  return value === "AB" || value === "BA";
}

function parseOptionOrder(
  value: unknown,
  questionOrder: readonly string[],
): Readonly<Record<string, MbtiOptionOrder>> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const result: Record<string, MbtiOptionOrder> = {};
  for (const questionId of questionOrder) {
    const entry = candidate[questionId];
    if (!isMbtiOptionOrder(entry)) {
      return null;
    }
    result[questionId] = entry;
  }
  return result;
}

/**
 * `k_play_sessions.progress_state.mbti`에서 읽어온 원시 JSONB 값을 안전하게 파싱한다.
 * DB 레벨 제약이 없는 애플리케이션 정의 컬럼이므로, shape이 어긋나면(빈 값/구버전/손상) 예외를
 * 던지지 않고 null을 반환해 호출부가 "저장된 진행 없음(→ 새 세션 생성)"으로 방어적으로 처리하게 한다.
 */
export function parseMbtiProgressState(value: unknown): MbtiProgressState | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;

  if (candidate.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    return null;
  }
  if (
    !Array.isArray(candidate.questionOrder) ||
    candidate.questionOrder.length !== TOTAL_QUESTIONS ||
    !candidate.questionOrder.every((id) => typeof id === "string")
  ) {
    return null;
  }
  const questionOrder = candidate.questionOrder as readonly string[];

  if (
    !Array.isArray(candidate.selectedQuestionIds) ||
    !candidate.selectedQuestionIds.every((id) => typeof id === "string")
  ) {
    return null;
  }

  const optionOrder = parseOptionOrder(candidate.optionOrder, questionOrder);
  if (optionOrder === null) {
    return null;
  }

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
    schemaVersion: CURRENT_SCHEMA_VERSION,
    questionOrder,
    selectedQuestionIds: candidate.selectedQuestionIds as readonly string[],
    optionOrder,
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
 * ⚠️ 호출부 계약: 이 함수는 fire-and-forget 호출을 전제로 한다. 이 Promise가
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
