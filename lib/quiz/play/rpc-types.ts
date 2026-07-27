import type { QuizAttemptStatus, QuizGrade, QuizSubmittedAnswers } from "./types";

/** 퀴즈마스터 프로젝트에서 포팅. quiz_engine_functions.sql의 Postgres 함수 반환 행 타입. */

export interface ApplySignalRow {
  accumulated_time_seconds: number;
  background_budget_remaining_seconds: number;
  status: QuizAttemptStatus;
  current_position: number;
  completed_count: number;
  submitted_answers: QuizSubmittedAnswers;
}

export interface EnterBackgroundRow {
  accumulated_time_seconds: number;
  background_budget_remaining_seconds: number;
  status: QuizAttemptStatus;
}

export interface SubmitAttemptRow {
  result_score: number | null;
  result_accumulated_time: number | null;
  result_cumulative_score: number | null;
  result_cumulative_time: number | null;
  result_completed_attempts: number | null;
  result_already_submitted: boolean;
  result_found: boolean;
}

export interface DrawnQuestionRow {
  id: string;
  question_text: string;
  options: string[];
}

export interface ClaimHandoffEntryRow {
  grade: QuizGrade;
  reward_transaction_id: string;
  child_id: string | null;
}
