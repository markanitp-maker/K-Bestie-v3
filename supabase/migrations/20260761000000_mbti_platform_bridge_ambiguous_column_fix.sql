-- Dev 실측 테스트 중 발견된 버그 수정: exchange_play_execution_ticket와
-- mark_play_execution_ticket_ready 두 함수 모두 RETURNS TABLE(...)의 OUT 파라미터
-- 이름(progress_state / success / reason)과 본문 내부에서 조회하는 실제 컬럼명이
-- 동일해 PL/pgSQL이 이를 구분하지 못하고 42702(column reference ambiguous) 오류를
-- 던졌다(실측: exchange-ticket 호출마다 100% 재현, 실 사용자 트래픽 전 발견).
-- 테이블 별칭/함수 별칭으로 명시적으로 한정해 해결한다 — 로직 자체는 변경 없음.

CREATE OR REPLACE FUNCTION public.exchange_play_execution_ticket(
  p_ticket_token TEXT
) RETURNS TABLE (
  success BOOLEAN,
  ticket_id UUID,
  play_session_id UUID,
  child_id UUID,
  progress_state JSONB,
  reason TEXT
) AS $$
DECLARE
  v_ticket RECORD;
  v_session_id UUID;
  v_progress_state JSONB;
BEGIN
  SELECT * INTO v_ticket
  FROM play_execution_tickets
  WHERE ticket_token = p_ticket_token
  FOR UPDATE;

  IF v_ticket IS NULL THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::UUID, NULL::JSONB, 'not_found'::text;
    RETURN;
  END IF;

  IF v_ticket.status = 'issued' AND v_ticket.expires_at <= now() THEN
    PERFORM public.restore_gold_key_reservation(v_ticket.reservation_id);
    UPDATE play_execution_tickets SET status = 'expired' WHERE id = v_ticket.id;
    RETURN QUERY SELECT false, v_ticket.id, NULL::UUID, NULL::UUID, NULL::JSONB, 'expired'::text;
    RETURN;
  END IF;

  IF v_ticket.status <> 'issued' THEN
    RETURN QUERY SELECT false, v_ticket.id, NULL::UUID, NULL::UUID, NULL::JSONB, ('invalid_status:' || v_ticket.status)::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_ticket.child_id::text));

  -- 수정: k_play_sessions에 별칭(kps)을 붙여 OUT 파라미터 progress_state와 구분
  SELECT kps.id, kps.progress_state INTO v_session_id, v_progress_state
  FROM k_play_sessions kps
  WHERE kps.child_id = v_ticket.child_id AND kps.play_type = v_ticket.play_id AND kps.status = 'in_progress'
  FOR UPDATE;

  IF v_session_id IS NULL THEN
    -- 수정: RETURNING 절도 테이블명으로 한정해 동일한 모호성을 피한다
    INSERT INTO k_play_sessions (child_id, play_type, keys_cost, status, started_at, expires_at)
    SELECT v_ticket.child_id, v_ticket.play_id, pr.keys_cost, 'in_progress', now(), now() + interval '6 hours'
    FROM play_registry pr WHERE pr.play_id = v_ticket.play_id
    RETURNING k_play_sessions.id, k_play_sessions.progress_state INTO v_session_id, v_progress_state;
  END IF;

  UPDATE play_execution_tickets
  SET status = 'exchanged', exchanged_at = now(), play_session_id = v_session_id
  WHERE id = v_ticket.id;

  RETURN QUERY SELECT true, v_ticket.id, v_session_id, v_ticket.child_id, v_progress_state, 'ok'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.exchange_play_execution_ticket(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exchange_play_execution_ticket(TEXT) TO service_role;


CREATE OR REPLACE FUNCTION public.mark_play_execution_ticket_ready(
  p_ticket_token TEXT,
  p_ready_timeout_seconds INTEGER DEFAULT 30
) RETURNS TABLE (
  success BOOLEAN,
  reason TEXT
) AS $$
DECLARE
  v_ticket RECORD;
  v_confirm_success BOOLEAN;
  v_confirm_reason TEXT;
BEGIN
  SELECT * INTO v_ticket
  FROM play_execution_tickets
  WHERE ticket_token = p_ticket_token
  FOR UPDATE;

  IF v_ticket IS NULL THEN
    RETURN QUERY SELECT false, 'not_found'::text;
    RETURN;
  END IF;

  IF v_ticket.status = 'exchanged'
     AND v_ticket.exchanged_at IS NOT NULL
     AND v_ticket.exchanged_at + make_interval(secs => p_ready_timeout_seconds) <= now()
  THEN
    PERFORM public.restore_gold_key_reservation(v_ticket.reservation_id);
    UPDATE play_execution_tickets SET status = 'expired' WHERE id = v_ticket.id;
    RETURN QUERY SELECT false, 'ready_timeout'::text;
    RETURN;
  END IF;

  IF v_ticket.status <> 'exchanged' THEN
    RETURN QUERY SELECT false, ('invalid_status:' || v_ticket.status)::text;
    RETURN;
  END IF;

  IF v_ticket.reservation_id IS NOT NULL THEN
    -- 수정: confirm_gold_key_reservation() 결과에 별칭(c)을 붙여 OUT 파라미터
    -- success/reason과 구분
    SELECT c.success, c.reason INTO v_confirm_success, v_confirm_reason
    FROM public.confirm_gold_key_reservation(v_ticket.reservation_id) AS c;

    IF NOT v_confirm_success THEN
      RETURN QUERY SELECT false, ('confirm_failed:' || v_confirm_reason)::text;
      RETURN;
    END IF;
  END IF;

  UPDATE play_execution_tickets
  SET status = 'ready', ready_at = now()
  WHERE id = v_ticket.id;

  RETURN QUERY SELECT true, 'ok'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.mark_play_execution_ticket_ready(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_play_execution_ticket_ready(TEXT, INTEGER) TO service_role;
