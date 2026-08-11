-- 2026-08-11 Dev P0 장애 복구: chat_sessions 스키마 백필 + get_or_create_chat_session RPC 정정.
-- Production DB는 대상 아님, Dev(mkrsaaedxqrcrktapaus) 전용.
--
-- 근거 1 (실제 재현·pg_catalog 대조로 확인, 추측 아님): app/api/mission/start/route.ts가
-- chat_sessions INSERT 시 mission_phase 컬럼을 직접 쓰는데(302~304행) Dev의 chat_sessions에는
-- 이 컬럼 자체가 없어 undefined_column(42703)으로 미션 시작이 실패한다. demo_mode/test_mode/
-- ended_reason도 함께 없었다(Production과 information_schema.columns 직접 비교로 확인).
--
-- 근거 2 (실제 재현·pg_get_functiondef로 Dev/Prod 함수 본문 바이트 단위 대조로 확인, 추측 아님):
-- get_or_create_chat_session RPC가 Dev에서는 session_type='free'로 조회·INSERT하는데,
-- chat_sessions_session_type_check 제약(Dev/Prod 동일)은 'mission'/'free_chat'만 허용한다.
-- 즉 자유대화 세션 생성 INSERT가 매번 CHECK 위반(23514)으로 실패한다. 제약 자체는 이미
-- Production과 완전히 동일(허용값 free_chat)하므로 제약은 건드리지 않고, RPC 본문의
-- 'free' 리터럴 2곳만 Production과 동일한 'free_chat'으로 정정한다.

BEGIN;

-- ── 1. chat_sessions 컬럼 백필 ──────────────────────────────────
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS demo_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mission_phase integer,
  ADD COLUMN IF NOT EXISTS test_mode text,
  ADD COLUMN IF NOT EXISTS ended_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_sessions_mission_phase_check') THEN
    ALTER TABLE public.chat_sessions
      ADD CONSTRAINT chat_sessions_mission_phase_check
      CHECK (
        (session_type = 'mission' AND (mission_phase = ANY (ARRAY[1, 2]) OR mission_phase IS NULL))
        OR (session_type <> 'mission' AND mission_phase IS NULL)
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_sessions_test_mode_check') THEN
    ALTER TABLE public.chat_sessions
      ADD CONSTRAINT chat_sessions_test_mode_check
      CHECK (test_mode IS NULL OR test_mode = ANY (ARRAY['A', 'B', 'C', 'D', 'E', 'F']));
  END IF;
END $$;

GRANT ALL ON public.chat_sessions TO anon, authenticated;

-- ── 2. get_or_create_chat_session RPC: 'free' → 'free_chat' 정정 (Production과 동일 본문) ──
CREATE OR REPLACE FUNCTION public.get_or_create_chat_session(p_child_id uuid, p_business_date date, p_conversation_window text)
 RETURNS TABLE(id uuid, created boolean)
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_session_id UUID;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(p_child_id::text || p_business_date::text || p_conversation_window));

    SELECT chat_sessions.id INTO v_session_id
    FROM chat_sessions
    LEFT JOIN chat_messages ON chat_sessions.id = chat_messages.session_id
    WHERE chat_sessions.child_id = p_child_id
      AND chat_sessions.business_date = p_business_date
      AND chat_sessions.conversation_window = p_conversation_window
      AND chat_sessions.session_type = 'free_chat'
    GROUP BY chat_sessions.id, chat_sessions.started_at
    ORDER BY (COUNT(chat_messages.id) > 0) DESC, COALESCE(MAX(chat_messages.created_at), chat_sessions.started_at) DESC
    LIMIT 1;

    IF v_session_id IS NOT NULL THEN
        RETURN QUERY SELECT v_session_id, false;
        RETURN;
    END IF;

    INSERT INTO chat_sessions (child_id, business_date, conversation_window, session_type)
    VALUES (p_child_id, p_business_date, p_conversation_window, 'free_chat')
    RETURNING chat_sessions.id INTO v_session_id;

    RETURN QUERY SELECT v_session_id, true;
    RETURN;
END;
$function$;

COMMIT;
