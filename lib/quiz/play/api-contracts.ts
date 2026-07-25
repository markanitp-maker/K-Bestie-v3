// requests/021 — 퀴즈마스터 프로젝트 api-contracts.ts에서 포팅, 경로만 K-Bestie 내부
// 네임스페이스(/api/quiz-play/*)로 조정. 문항 options는 서버에서 이미 표시 순서로
// 재배열돼 내려오므로 클라이언트는 그대로 렌더링하고 탭한 배열 인덱스(0-3)를 그대로 제출한다.
// correct_option_index는 어떤 응답에도 포함되지 않는다.

import type { QuizGrade, QuizSubject, QuizAttemptStatus } from "./types";

export const QUIZ_REDEEM_PATH = "/api/quiz-play/redeem";
export const QUIZ_START_PATH = "/api/quiz-play/start";
export const QUIZ_PROGRESS_PATH = "/api/quiz-play/progress";
export const QUIZ_SUBMIT_PATH = "/api/quiz-play/submit";
export const QUIZ_HEARTBEAT_PATH = "/api/quiz-play/heartbeat";
export const QUIZ_BACKGROUND_PATH = "/api/quiz-play/background";
export const QUIZ_BUG_REPORT_PATH = "/api/quiz-play/bug-report";

export function quizAttemptHydratePath(attemptId: string): string {
  return `/api/quiz-play/attempt/${attemptId}`;
}

export interface QuizPlayQuestion {
  id: string;
  question_text: string;
  options: string[];
}

export interface QuizRedeemRequest {
  token: string;
  childId: string;
}

export interface QuizRedeemResponse {
  grade: QuizGrade;
}

export interface QuizStartRequest {
  childId: string;
  grade: QuizGrade;
  subject: QuizSubject;
}

export interface QuizStartResponse {
  attemptId: string;
  grade: QuizGrade;
  subject: QuizSubject;
  status: QuizAttemptStatus;
  current_position: number;
  completed_count: number;
  submitted_answers: Record<string, number>;
  accumulated_time_seconds: number;
  started_at: string;
  expires_at: string;
  questions: QuizPlayQuestion[];
}

export interface QuizAttemptHydrateResponse {
  attempt: {
    id: string;
    grade: QuizGrade;
    subject: QuizSubject;
    status: QuizAttemptStatus;
    current_position: number;
    completed_count: number;
    submitted_answers: Record<string, number>;
    accumulated_time_seconds: number;
    started_at: string;
    expires_at: string;
    score: number | null;
  };
  questions: QuizPlayQuestion[];
}

export interface QuizProgressRequest {
  attemptId: string;
  current_position?: number;
  answers?: Record<string, number>;
}

export interface QuizProgressResponse {
  status: QuizAttemptStatus;
  current_position: number;
  completed_count: number;
  accumulated_time_seconds: number;
}

export interface QuizSubmitRequest {
  attemptId: string;
  answers?: Record<string, number>;
}

export interface QuizSubmitResponse {
  score: number;
  accumulated_time_seconds: number;
  cumulative_score: number | null;
  cumulative_time: number | null;
  rank: number | null;
  status: "submitted";
  already_submitted: boolean;
}

export interface QuizHeartbeatRequest {
  attemptId: string;
}

export interface QuizHeartbeatResponse {
  status: QuizAttemptStatus;
  accumulated_time_seconds: number;
}

export interface QuizBackgroundRequest {
  attemptId: string;
}

export interface QuizBackgroundResponse {
  status: "background";
  accumulated_time_seconds: number;
}

export type QuizApiErrorCode =
  | "UNAUTHENTICATED"
  | "ATTEMPT_NOT_FOUND"
  | "FORBIDDEN"
  | "DEVICE_TAKEOVER"
  | "ATTEMPT_ALREADY_SUBMITTED"
  | "ATTEMPT_EXPIRED"
  | "INVALID_REQUEST"
  | "QUESTION_POOL_EMPTY"
  | "TOKEN_INVALID"
  | "GRADE_LOOKUP_FAILED"
  | "INTERNAL";

export interface QuizApiErrorBody {
  code: QuizApiErrorCode;
  message?: string;
}
