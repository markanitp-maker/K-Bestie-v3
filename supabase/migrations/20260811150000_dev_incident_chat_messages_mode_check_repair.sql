-- 2026-08-11 Dev P0 장애 복구: chat_messages_mode_check 제약 복구.
-- Production DB는 대상 아님, Dev(mkrsaaedxqrcrktapaus) 전용.
--
-- 근거 (실제 재현·Vercel 실시간 런타임 로그로 확인, 추측 아님): 형진님이 Dev에서
-- 자유대화를 실제 목소리로 진행했으나 매 메시지가 POST /api/chat/messages 500으로
-- 실패했다. 에러: "new row for relation chat_messages violates check constraint
-- chat_messages_mode_check", mode='free_chat'. pg_constraint 직접 대조 결과 Dev는
-- CHECK (mode = ANY (ARRAY['mission','free'])) 구버전이고 Production은
-- CHECK (mode = ANY (ARRAY['mission','free_chat'])) 신버전이다 — chat_sessions_
-- session_type_check(20260811130000에서 이미 복구)와 동일한 free→free_chat 개명
-- 계열의 별도 테이블 잔존 사고다. 앱 코드는 이미 올바르게 'free_chat'을 보내고
-- 있으므로(로그로 확인) Dev 제약만 Production과 동일하게 맞춘다.

ALTER TABLE public.chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_mode_check;
ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_mode_check
  CHECK (mode = ANY (ARRAY['mission'::text, 'free_chat'::text]));
