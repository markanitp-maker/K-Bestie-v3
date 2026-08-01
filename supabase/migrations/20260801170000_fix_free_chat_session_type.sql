-- Fix free_chat session_type in chat_sessions
ALTER TABLE public.chat_sessions DROP CONSTRAINT IF EXISTS chat_sessions_session_type_check;

UPDATE public.chat_sessions 
SET session_type = 'free_chat' 
WHERE session_type = 'free';

ALTER TABLE public.chat_sessions 
ADD CONSTRAINT chat_sessions_session_type_check 
CHECK (session_type IN ('mission', 'free_chat'));
