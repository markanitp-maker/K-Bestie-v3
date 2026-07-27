// requests/021 — 퀴즈마스터 프로젝트 api-contracts.ts에서 포팅, 경로만 K-Bestie 내부
// 네임스페이스(/api/quiz-play/*)로 조정. 문항 options는 서버에서 이미 표시 순서로
// 재배열돼 내려오므로 클라이언트는 그대로 렌더링하고 탭한 배열 인덱스(0-3)를 그대로 제출한다.
// correct_option_index는 어떤 응답에도 포함되지 않는다.

import type { QuizGrade, QuizSubject, QuizAttemptStatus, QuizLeaderboardPublicEntry } from "./types";

export const QUIZ_REDEEM_PATH = "/api/quiz-play/redeem";
export const QUIZ_START_PATH = "/api/quiz-play/start";
export const QUIZ_PROGRESS_PATH = "/api/quiz-play/progress";
export const QUIZ_SUBMIT_PATH = "/api/quiz-play/submit";
export const QUIZ_HEARTBEAT_PATH = "/api/quiz-play/heartbeat";
export const QUIZ_BACKGROUND_PATH = "/api/quiz-play/background";
export const QUIZ_BUG_REPORT_PATH = "/api/quiz-play/bug-report";
export const QUIZ_LEADERBOARD_PATH = "/api/quiz-play/leaderboard";

/** 리더보드는 아이(child_id) 단위이므로 본인 순위를 받으려면 childId를 실어 보낸다. */
export function quizLeaderboardPath(childId?: string | null): string {
  return childId
    ? `${QUIZ_LEADERBOARD_PATH}?childId=${encodeURIComponent(childId)}`
    : QUIZ_LEADERBOARD_PATH;
}

export function quizAttemptHydratePath(attemptId: string): string {
  return `/api/quiz-play/attempt/${attemptId}`;
}

export function quizAttemptClaimPath(attemptId: string): string {
  return `/api/quiz-play/attempt/${attemptId}/claim`;
}

export const QUIZ_ATTEMPT_ACTIVE_PATH = "/api/quiz-play/attempt/active";

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
  /** 이번 판 점수. */
  score: number;
  /** 이번 판 서버 확정 풀이시간(초). */
  accumulated_time_seconds: number;
  /** 이 아이(child_id)의 누적 점수. 리더보드 행이 없으면 null. */
  cumulative_score: number | null;
  /** 이 아이의 누적 풀이시간(초). */
  cumulative_time: number | null;
  /** 이 아이의 누적 완료 횟수. */
  completed_attempts: number | null;
  /** 이 아이의 현재 순위(상위 목록 밖이어도 채워진다). */
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

/**
 * GET /api/quiz-play/leaderboard[?childId=...]
 * entries는 시드(더미)와 실사용자를 같은 정렬 풀에서 뽑은 상위 N명이고,
 * self는 그 상위 목록 밖이더라도 항상 채워지는 "이 아이 본인" 항목이다
 * (아직 한 판도 완료하지 않아 리더보드 행이 없으면 null).
 */
export interface QuizLeaderboardResponse {
  entries: QuizLeaderboardPublicEntry[];
  self: { rank: number; entry: QuizLeaderboardPublicEntry } | null;
}

/** GET /api/quiz-play/attempt/active — 독립 퀴즈마스터 프로젝트에서 포팅. */
export interface QuizAttemptActiveResponse {
  attemptId: string | null;
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
