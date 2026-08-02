-- Forward-fix: Add CLARIFICATION_NEEDED to mission_question_history's answer_classification

ALTER TABLE mission_question_history
  DROP CONSTRAINT IF EXISTS mission_question_history_answer_classification_check;

ALTER TABLE mission_question_history
  ADD CONSTRAINT mission_question_history_answer_classification_check
  CHECK (answer_classification IN ('VALID', 'PARTIAL', 'REFUSAL', 'NO_RESPONSE', 'SAFETY_SIGNAL', 'CLARIFICATION_NEEDED'));

-- Add clarification_counts to mission_progress to track retries per question
ALTER TABLE mission_progress ADD COLUMN IF NOT EXISTS clarification_counts JSONB NOT NULL DEFAULT '{}'::jsonb;
