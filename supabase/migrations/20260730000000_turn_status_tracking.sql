ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS turn_status TEXT NOT NULL DEFAULT 'finalized';

DO $$ 
BEGIN 
    ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_turn_status_check CHECK (turn_status IN ('finalized','cancelled'));
EXCEPTION 
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_turnstatus ON chat_messages(session_id, turn_status, display_sequence);
