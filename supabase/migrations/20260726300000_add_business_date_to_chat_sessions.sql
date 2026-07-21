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

CREATE OR REPLACE FUNCTION get_or_create_chat_session(
    p_child_id UUID,
    p_business_date DATE,
    p_conversation_window TEXT
) RETURNS UUID AS $$
DECLARE
    v_session_id UUID;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(p_child_id::text || p_business_date::text || p_conversation_window));

    SELECT id INTO v_session_id
    FROM chat_sessions
    WHERE child_id = p_child_id
      AND business_date = p_business_date
      AND conversation_window = p_conversation_window
      AND session_type = 'free'
    ORDER BY started_at DESC
    LIMIT 1;

    IF v_session_id IS NOT NULL THEN
        RETURN v_session_id;
    END IF;

    INSERT INTO chat_sessions (child_id, business_date, conversation_window, session_type)
    VALUES (p_child_id, p_business_date, p_conversation_window, 'free')
    RETURNING id INTO v_session_id;

    RETURN v_session_id;
END;
$$ LANGUAGE plpgsql;
