-- 자유 대화 mode 컬럼 CHECK 제약이 'free'만 허용해 신규 'free_chat' 값이 매 저장마다
-- 위반되어 chat_messages upsert가 항상 실패하던 버그 수정.
-- (chat_sessions.session_type은 20260801170000에서 이미 free_chat으로 전환됨 — 그때
--  chat_messages.mode 컬럼은 누락되어 있었음)
ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_mode_check;

UPDATE public.chat_messages
SET mode = 'free_chat'
WHERE mode = 'free';

ALTER TABLE public.chat_messages
ADD CONSTRAINT chat_messages_mode_check
CHECK (mode IN ('mission', 'free_chat'));
