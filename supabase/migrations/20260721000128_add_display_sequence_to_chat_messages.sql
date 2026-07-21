ALTER TABLE chat_messages
  ADD COLUMN display_sequence BIGINT NULL,
  ADD COLUMN turn_id TEXT NOT NULL DEFAULT gen_random_uuid()::text;

COMMENT ON COLUMN chat_messages.display_sequence IS '화면 렌더링 순서 고정을 위한 세션 내 단조증가(timestamp 등) 값. 예약된 슬롯 순서를 보장한다.';

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_session_id_turn_id_key UNIQUE (session_id, turn_id);

GRANT ALL ON chat_messages TO anon, authenticated;
