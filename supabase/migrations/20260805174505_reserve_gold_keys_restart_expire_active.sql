-- 새로 시작하기: 기존 세션 물리 삭제 금지, 종료 상태 전환
-- p_is_restart=true 일 때, 기존 in_progress 세션을 재사용하지 않고
-- expired로 전환하여 신규 세션이 생성되게끔 한다.
-- start_new_play_session 도 기존 세션 재사용을 중단하고 항상 신규 세션을 생성하도록 수정.

CREATE OR REPLACE FUNCTION public.reserve_gold_keys_for_play(
  p_child_id UUID,
  p_play_type TEXT,
  p_keys_needed INTEGER,
  p_is_restart BOOLEAN DEFAULT false
) RETURNS TABLE (
  reservation_id UUID,
  reason TEXT
) AS $$
DECLARE
  v_ids UUID[];
  v_res_id UUID;
  v_active_session_id UUID;
  v_stale_session_id UUID;
  v_stale_reservation_id UUID;
BEGIN
  IF p_keys_needed IS NULL OR p_keys_needed <= 0 THEN
    RETURN QUERY SELECT NULL::UUID, 'invalid_amount'::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_child_id::text));

  IF p_is_restart = false THEN
    SELECT id INTO v_active_session_id
    FROM k_play_sessions
    WHERE child_id = p_child_id
      AND play_type = p_play_type
      AND status = 'in_progress'
      AND (resume_expires_at IS NULL OR resume_expires_at > now())
    FOR UPDATE;

    IF v_active_session_id IS NOT NULL THEN
      RETURN QUERY SELECT NULL::UUID, 'already_in_progress'::text;
      RETURN;
    END IF;
  END IF;

  -- 만료된 세션 정리 (restart 여부와 상관없이 정리하거나, restart 시에도 정리)
  -- restart 일 경우 기간이 남아있어도 정리 대상이다.
  SELECT id INTO v_stale_session_id
  FROM k_play_sessions
  WHERE child_id = p_child_id
    AND play_type = p_play_type
    AND status = 'in_progress'
    AND (
      (p_is_restart = false AND resume_expires_at IS NOT NULL AND resume_expires_at <= now())
      OR (p_is_restart = true)
    )
  FOR UPDATE;

  SELECT array_agg(id) INTO v_ids FROM (
    SELECT id FROM gold_key_ledger
    WHERE child_id = p_child_id
      AND consumed = false
      AND reserved_by_reservation_id IS NULL
      AND expires_at > now()
    ORDER BY earned_at ASC, id ASC
    LIMIT p_keys_needed
    FOR UPDATE
  ) sub;

  IF v_ids IS NULL OR array_length(v_ids, 1) < p_keys_needed THEN
    RETURN QUERY SELECT NULL::UUID, 'insufficient_balance'::text;
    RETURN;
  END IF;

  -- 열쇠가 충분하여 예약이 확정된 시점에 기존 세션 종료 및 복구 처리 (원자성)
  IF v_stale_session_id IS NOT NULL THEN
    FOR v_stale_reservation_id IN
      SELECT id FROM gold_key_reservations
      WHERE child_id = p_child_id AND play_type = p_play_type AND status = 'reserved'
      FOR UPDATE
    LOOP
      PERFORM public.restore_gold_key_reservation(v_stale_reservation_id);
    END LOOP;

    UPDATE k_play_sessions
    SET status = 'expired', updated_at = now()
    WHERE id = v_stale_session_id;
  END IF;

  INSERT INTO gold_key_reservations (child_id, play_type, keys_needed, status)
  VALUES (p_child_id, p_play_type, p_keys_needed, 'reserved')
  RETURNING id INTO v_res_id;

  UPDATE gold_key_ledger
  SET reserved_by_reservation_id = v_res_id
  WHERE id = ANY(v_ids);

  RETURN QUERY SELECT v_res_id, 'ok'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.reserve_gold_keys_for_play(UUID, TEXT, INTEGER, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_gold_keys_for_play(UUID, TEXT, INTEGER, BOOLEAN) TO service_role;


CREATE OR REPLACE FUNCTION public.start_new_play_session(
  p_child_id UUID,
  p_play_type TEXT,
  p_new_reservation_id UUID
) RETURNS TABLE (
  session_id UUID,
  reason TEXT
) AS $$
DECLARE
  v_confirm_success BOOLEAN;
  v_header_id UUID;
  v_confirm_reason TEXT;
  v_keys_cost INTEGER;
  v_new_session_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_child_id::text));

  SELECT success, header_id, cr.reason 
  INTO v_confirm_success, v_header_id, v_confirm_reason
  FROM confirm_gold_key_reservation(p_new_reservation_id) cr;

  IF NOT v_confirm_success THEN
    RETURN QUERY SELECT NULL::UUID, 'confirm_failed: ' || v_confirm_reason;
    RETURN;
  END IF;

  IF p_play_type IN ('comic_book', 'quiz') THEN
    v_keys_cost := 2;
  ELSIF p_play_type IN ('hairstyle', 'mbti') THEN
    v_keys_cost := 3;
  ELSE
    v_keys_cost := 3;
  END IF;

  INSERT INTO k_play_sessions (
    child_id, 
    play_type, 
    keys_cost, 
    status, 
    started_at, 
    resume_expires_at, 
    expires_at
  ) VALUES (
    p_child_id, 
    p_play_type, 
    v_keys_cost, 
    'in_progress', 
    now(), 
    now() + interval '6 hours', 
    now() + interval '24 hours' 
  ) RETURNING id INTO v_new_session_id;

  UPDATE gold_key_consumptions
  SET play_session_id = v_new_session_id
  WHERE id = v_header_id;

  UPDATE gold_key_ledger
  SET consumed_by_play_session_id = v_new_session_id
  WHERE reserved_by_reservation_id = p_new_reservation_id;

  RETURN QUERY SELECT v_new_session_id, 'ok'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.start_new_play_session(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_new_play_session(UUID, TEXT, UUID) TO service_role;
