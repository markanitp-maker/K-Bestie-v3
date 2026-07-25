import type { QuizApiErrorCode } from "./api-contracts";

// 퀴즈마스터 프로젝트에서 포팅 — UI용 정규화 에러 매핑.

export interface QuizUiError {
  code: string;
  location: string;
  userMessage: string;
  isDeviceTakeover: boolean;
}

const MESSAGES: Record<QuizApiErrorCode, string> = {
  UNAUTHENTICATED: "로그인이 만료되었어요. 다시 시도해 주세요.",
  ATTEMPT_NOT_FOUND: "응시 정보를 찾을 수 없어요.",
  FORBIDDEN: "이 응시에 접근할 수 없어요.",
  DEVICE_TAKEOVER: "다른 기기에서 진행 중이에요.",
  ATTEMPT_ALREADY_SUBMITTED: "이미 제출된 응시예요.",
  ATTEMPT_EXPIRED: "응시 가능 시간이 지났어요.",
  INVALID_REQUEST: "요청이 올바르지 않아요.",
  QUESTION_POOL_EMPTY: "문제를 준비하지 못했어요.",
  TOKEN_INVALID: "입장 정보가 만료됐어요. 놀이 화면에서 다시 시작해 주세요.",
  GRADE_LOOKUP_FAILED: "학년 정보를 확인하지 못했어요.",
  INTERNAL: "서버에 문제가 발생했어요.",
};

const KNOWN_CODES = new Set(Object.keys(MESSAGES));

function isQuizApiErrorCode(value: unknown): value is QuizApiErrorCode {
  return typeof value === "string" && KNOWN_CODES.has(value);
}

export function mapQuizApiError(body: unknown, location: string): QuizUiError {
  const code =
    typeof body === "object" && body !== null && "code" in body
      ? (body as { code: unknown }).code
      : undefined;

  if (isQuizApiErrorCode(code)) {
    return {
      code,
      location,
      userMessage: MESSAGES[code],
      isDeviceTakeover: code === "DEVICE_TAKEOVER",
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    location,
    userMessage: "문제가 발생했어요. 아래 버튼으로 계속하거나 신고해 주세요.",
    isDeviceTakeover: false,
  };
}

export function mapThrownError(_err: unknown, location: string): QuizUiError {
  return {
    code: "NETWORK_OR_CLIENT_ERROR",
    location,
    userMessage: "문제가 발생했어요. 아래 버튼으로 계속하거나 신고해 주세요.",
    isDeviceTakeover: false,
  };
}

export function extractErrorDetail(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
