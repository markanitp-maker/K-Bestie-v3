-- Migration: 20260725310000_goldkey_reserve_restart_fix.sql
-- Description: Adds p_is_restart parameter to reserve_gold_keys_for_play to support restarting play sessions.

DROP FUNCTION IF EXISTS public.reserve_gold_keys_for_play(UUID, TEXT, INTEGER);

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
BEGIN
  IF p_keys_needed IS NULL OR p_keys_needed <= 0 THEN
    RETURN QUERY SELECT NULL::UUID, 'invalid_amount'::text;
    RETURN;
  END IF;

  -- 락 획득 (원자성, 동시성 안전)
  PERFORM pg_advisory_xact_lock(hashtext(p_child_id::text));

  -- 기존 진행중 세션 여부 확인 (idx_k_play_sessions_one_active 제약 기준)
  -- p_is_restart가 true일 경우, 기존 진행 중인 세션이 있더라도 예약을 진행합니다. (재시작용)
  IF p_is_restart = false THEN
    IF EXISTS (
      SELECT 1 FROM k_play_sessions 
      WHERE child_id = p_child_id 
        AND play_type = p_play_type 
        AND status = 'in_progress'
    ) THEN
      RETURN QUERY SELECT NULL::UUID, 'already_in_progress'::text;
      RETURN;
    END IF;
  END IF;

  -- 예약 가능한 열쇠 선별 (지급시각 오름차순 FIFO)
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

  -- 예약 레코드 생성
  INSERT INTO gold_key_reservations (child_id, play_type, keys_needed, status)
  VALUES (p_child_id, p_play_type, p_keys_needed, 'reserved')
  RETURNING id INTO v_res_id;

  -- 열쇠 상태 변경
  UPDATE gold_key_ledger
  SET reserved_by_reservation_id = v_res_id
  WHERE id = ANY(v_ids);

  RETURN QUERY SELECT v_res_id, 'ok'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.reserve_gold_keys_for_play(UUID, TEXT, INTEGER, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_gold_keys_for_play(UUID, TEXT, INTEGER, BOOLEAN) TO service_role;

-- 2. start_new_play_session (문서화 주석만 추가)
CREATE OR REPLACE FUNCTION public.start_new_play_session(
  p_child_id UUID,
  p_play_type TEXT,
  p_new_reservation_id UUID
) RETURNS TABLE (
  session_id UUID,
  reason TEXT
) AS $$
DECLARE
  v_existing_session_id UUID;
  v_confirm_success BOOLEAN;
  v_header_id UUID;
  v_confirm_reason TEXT;
  v_keys_cost INTEGER;
  v_new_session_id UUID;
BEGIN
  -- 문서화 주석: p_new_reservation_id로 전달되는 예약은
  -- p_is_restart = true 로 생성된 재시작용 예약이거나, 신규 시작용 예약일 수 있습니다.
  -- 이미 존재하는 in_progress 세션이 있으면 해당 세션을 재사용(초기화)합니다.

  -- 락 획득
  PERFORM pg_advisory_xact_lock(hashtext(p_child_id::text));

  -- 1. 예약 확정 
  SELECT success, header_id, cr.reason 
  INTO v_confirm_success, v_header_id, v_confirm_reason
  FROM confirm_gold_key_reservation(p_new_reservation_id) cr;

  IF NOT v_confirm_success THEN
    RETURN QUERY SELECT NULL::UUID, 'confirm_failed: ' || v_confirm_reason;
    RETURN;
  END IF;

  -- 2. 세션 조회 및 초기화
  SELECT id INTO v_existing_session_id
  FROM k_play_sessions
  WHERE child_id = p_child_id AND play_type = p_play_type AND status = 'in_progress'
  FOR UPDATE;

  -- keys_cost 산출
  IF p_play_type IN ('comic_book', 'quiz') THEN
    v_keys_cost := 2;
  ELSIF p_play_type IN ('hairstyle', 'mbti') THEN
    v_keys_cost := 3;
  ELSE
    v_keys_cost := 3; -- fallback
  END IF;

  IF v_existing_session_id IS NOT NULL THEN
    -- 기존 세션 초기화
    UPDATE k_play_sessions
    SET 
      progress_state = '{}'::jsonb,
      started_at = now(),
      resume_expires_at = now() + interval '6 hours',
      updated_at = now()
    WHERE id = v_existing_session_id;
    
    v_new_session_id := v_existing_session_id;
  ELSE
    -- 새 세션 생성
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
  END IF;

  -- gold_key_consumptions와 ledger에 session_id 연결
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
