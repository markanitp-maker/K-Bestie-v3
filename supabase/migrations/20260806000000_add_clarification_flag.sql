-- Add is_clarification flag to messages tables
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_clarification BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE raw_daily_conversation_messages_v3 ADD COLUMN IF NOT EXISTS is_clarification BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE corrected_daily_conversation_messages_v3 ADD COLUMN IF NOT EXISTS is_clarification BOOLEAN NOT NULL DEFAULT false;
