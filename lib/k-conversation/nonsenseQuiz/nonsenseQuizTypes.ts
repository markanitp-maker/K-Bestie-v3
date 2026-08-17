export type NonsenseQuestionStatus = "ACTIVE" | "REVIEW" | "REJECTED" | "DEPRECATED";

export type NonsenseSessionState =
  | "OFFERED"
  | "PLAYING_K_ASKS"
  | "PLAYING_CHILD_ASKS"
  | "WAITING_FOR_ANSWER"
  | "HINT"
  | "ROUND_RESULT"
  | "SUSPENDED"
  | "ENDED";

export type NonsenseInitiatedBy = "CHILD" | "K";

export type NonsenseHistoryOutcome =
  | "PRESENTED"
  | "ANSWERED"
  | "SKIPPED"
  | "ANSWERED_CORRECT"
  | "ANSWERED_INCORRECT"
  | "TOPIC_SHIFT";

export interface NonsenseQuestionRow {
  id: string;
  concept_key: string;
  question: string;
  canonical_answer: string;
  accepted_answers: string[];
  hint_1: string | null;
  hint_2: string | null;
  explanation: string | null;
  category: string | null;
  pun_type: string | null;
  difficulty: number;
  min_grade: number;
  max_grade: number;
  primary_grade_band?: string | null;
  status: NonsenseQuestionStatus;
  child_safe: boolean;
  source_type?: string | null;
  quality_score?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface NonsenseGameSessionRow {
  id: string;
  child_id: string;
  chat_session_id: string;
  initiated_by: NonsenseInitiatedBy;
  state: NonsenseSessionState;
  current_question_id: string | null;
  current_difficulty: number;
  hint_level: number;
  recent_question_ids: string[];
  started_at: string;
  updated_at: string;
  ended_at: string | null;
}

export interface NonsenseQuestionHistoryRow {
  id: string;
  child_id: string;
  question_id: string;
  chat_session_id?: string | null;
  game_session_id?: string | null;
  outcome: NonsenseHistoryOutcome;
  presented_at: string;
  answered_at?: string | null;
  hint_count: number;
  created_at?: string;
  updated_at?: string;
}
