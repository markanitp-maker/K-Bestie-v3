ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS business_date DATE;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS conversation_window TEXT CHECK (conversation_window IN ('day', 'evening'));

UPDATE chat_sessions
SET 
    business_date = DATE(timezone('Asia/Seoul', started_at)),
    conversation_window = CASE 
        WHEN EXTRACT(HOUR FROM timezone('Asia/Seoul', started_at)) < 18 THEN 'day'
        ELSE 'evening'
    END
WHERE business_date IS NULL;

GRANT ALL ON chat_sessions TO anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_sessions_free_unique
ON chat_sessions(child_id, business_date, conversation_window)
WHERE session_type = 'free' OR session_type IS NULL;
