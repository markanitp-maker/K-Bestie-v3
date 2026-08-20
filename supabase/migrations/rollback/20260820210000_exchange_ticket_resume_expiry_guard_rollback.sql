-- DRAFT: 실행 전 사용자 승인 필요, 아직 미적용
-- 목적: 20260820210000_exchange_ticket_resume_expiry_guard.sql 롤백
-- 20260820190000 정의로 복원하며 backfill 데이터는 변경하지 않는다.

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

  SELECT kps.id, kps.progress_state INTO v_session_id, v_progress_state
  FROM k_play_sessions kps
  WHERE kps.child_id = v_ticket.child_id AND kps.play_type = v_ticket.play_id AND kps.status = 'in_progress'
  FOR UPDATE;

  IF v_session_id IS NULL THEN
    INSERT INTO k_play_sessions (child_id, play_type, keys_cost, status, started_at, expires_at, resume_expires_at)
    SELECT v_ticket.child_id, v_ticket.play_id, pr.keys_cost, 'in_progress', now(),
           now() + interval '24 hours',
           now() + make_interval(hours => pr.resume_ttl_hours)
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
