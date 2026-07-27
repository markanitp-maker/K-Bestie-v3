// requests/021 — 퀴즈마스터 프로젝트(lib/quiz/types.ts)에서 포팅. 순수 데이터 타입,
// quiz_attempts/quiz_handoff_tokens/quiz_question_bank/quiz_leaderboard/quiz_bug_reports
// 테이블은 K-Bestie와 퀴즈마스터가 같은 Supabase 프로젝트를 공유하므로 스키마 그대로 재사용한다.

export type QuizGrade = 1 | 2 | 3 | 4 | 5 | 6;

export type QuizSubject = "국어" | "영어" | "수학" | "과학" | "사회" | "창의" | "상식";

export type QuizAttemptStatus =
  | "in_progress"
  | "background"
  | "disconnected"
  | "submitted"
  | "expired";

/** 문항별 선택 답안, quiz_question_bank.id로 키잉. */
export type QuizSubmittedAnswers = Record<string, number>;

/** 문항별 옵션 표시 순서, quiz_question_bank.id로 키잉. */
export type QuizOptionOrder = Record<string, number[]>;

export interface QuizAttemptRow {
  id: string;
  user_id: string;

  device_id: string;
  session_token: string;

  grade: QuizGrade;
  subject: QuizSubject;
  selected_questions: string[];
  option_order: QuizOptionOrder;

  submitted_answers: QuizSubmittedAnswers;
  completed_count: number;
  current_position: number;

  accumulated_time_seconds: number;
  background_budget_remaining_seconds: number;
  last_server_signal_at: string;
  background_entered_at: string | null;

  status: QuizAttemptStatus;

  score: number | null;

  reward_transaction_id: string | null;
  child_id: string | null;
  refund_requested_at: string | null;
  refund_confirmed_at: string | null;
  completion_notified_at: string | null;

  started_at: string;
  submitted_at: string | null;
  created_at: string;
}

export interface QuizHandoffTokenRow {
  token: string;
  user_id: string;
  status: "pending" | "mint_failed" | "consumed" | "claimed";
  mint_attempts: number;
  issued_at: string;
  expires_at: string;
  created_at: string;
  grade: QuizGrade | null;
  reward_transaction_id: string | null;
  child_id: string | null;
}

export interface QuizQuestionBankRow {
  id: string;
  grade: QuizGrade;
  subject: QuizSubject;
  question_text: string;
  options: string[];
  correct_option_index: 0 | 1 | 2 | 3; // 절대 클라이언트로 보내지 않는다

  subject_ko: string | null;
  curriculum: string | null;
  question_number: number | null;
  explanation: string | null;
  source_file: string | null;
  duplicate_group_id: string | null;

  created_at: string;
}

export type QuizQuestionPublic = Omit<QuizQuestionBankRow, "correct_option_index">;

/**
 * quiz_leaderboard 행. 고유 단위는 child_id(아이)다 — 같은 보호자 계정으로 여러
 * 자녀를 플레이시켜도 자녀마다 별도 행이 된다. user_id는 "마지막으로 이 아이를
 * 플레이시킨 로그인 계정" 메타데이터일 뿐 고유키가 아니다.
 * cumulative_time은 초 단위(double precision)다.
 */
export interface QuizLeaderboardRow {
  child_id: string;
  user_id: string;
  name: string;
  login_id: string;
  is_seed_user: boolean;
  is_reward_eligible: boolean;
  cumulative_score: number;
  cumulative_time: number;
  completed_attempts: number;
  created_at: string;
  updated_at: string;
}

/**
 * 클라이언트로 나가는 리더보드 항목. child_id/user_id/login_id 원본은 싣지 않는다
 * (다른 가정 아이의 UUID·로그인 아이디 노출 방지). 렌더 key/본인 식별에는
 * 되돌릴 수 없는 entry_key와 서버가 계산한 is_self만 쓴다.
 */
export type QuizLeaderboardPublicEntry = Omit<
  QuizLeaderboardRow,
  "child_id" | "user_id" | "login_id"
> & {
  entry_key: string;
  masked_id: string;
  is_self: boolean;
};

export interface QuizBugReportRow {
  id: string;
  session_id: string | null;
  user_id: string;
  occurred_at: string;
  location: string;
  error_code: string;
  detail_log: string | null;
  block_reason: string | null;
  created_at: string;
}
