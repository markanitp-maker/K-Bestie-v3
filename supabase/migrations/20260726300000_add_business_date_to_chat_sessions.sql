-- 이 UPDATE는 대화 원문이 아닌 신규 메타데이터 컬럼(business_date, conversation_window) 백필용이라 의도된 것
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

CREATE OR REPLACE FUNCTION get_or_create_chat_session(
    p_child_id UUID,
    p_business_date DATE,
    p_conversation_window TEXT
) RETURNS UUID AS $$
DECLARE
    v_session_id UUID;
BEGIN
    SELECT id INTO v_session_id
    FROM chat_sessions
    WHERE child_id = p_child_id
      AND business_date = p_business_date
      AND conversation_window = p_conversation_window
      AND (session_type = 'free' OR session_type IS NULL)
    ORDER BY started_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_session_id IS NOT NULL THEN
        RETURN v_session_id;
    END IF;

    INSERT INTO chat_sessions (child_id, business_date, conversation_window, session_type)
    VALUES (p_child_id, p_business_date, p_conversation_window, 'free')
    ON CONFLICT (child_id, business_date, conversation_window) WHERE (session_type = 'free' OR session_type IS NULL)
    DO NOTHING
    RETURNING id INTO v_session_id;

    IF v_session_id IS NULL THEN
        SELECT id INTO v_session_id
        FROM chat_sessions
        WHERE child_id = p_child_id
          AND business_date = p_business_date
          AND conversation_window = p_conversation_window
          AND (session_type = 'free' OR session_type IS NULL)
        ORDER BY started_at DESC
        LIMIT 1;
    END IF;

    RETURN v_session_id;
END;
$$ LANGUAGE plpgsql;
