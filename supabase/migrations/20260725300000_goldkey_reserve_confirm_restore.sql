-- Migration: 20260725300000_goldkey_reserve_confirm_restore.sql

-- 1. Create gold_key_reservations
CREATE TABLE gold_key_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  play_type TEXT NOT NULL,
  keys_needed INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'confirmed', 'restored')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE gold_key_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gold_key_reservations_select_parent_only"
  ON gold_key_reservations FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = gold_key_reservations.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );

CREATE POLICY "gold_key_reservations_write_service_only"
  ON gold_key_reservations FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON public.gold_key_reservations TO anon, authenticated;

-- 2. Alter gold_key_ledger
ALTER TABLE gold_key_ledger
  ADD COLUMN reserved_by_reservation_id UUID REFERENCES gold_key_reservations(id) ON DELETE SET NULL;

-- 3. Alter k_play_sessions
ALTER TABLE k_play_sessions
  ADD COLUMN resume_expires_at TIMESTAMPTZ;

-- 4. reserve_gold_keys_for_play
CREATE OR REPLACE FUNCTION public.reserve_gold_keys_for_play(
  p_child_id UUID,
  p_play_type TEXT,
  p_keys_needed INTEGER
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
  IF EXISTS (
    SELECT 1 FROM k_play_sessions 
    WHERE child_id = p_child_id 
      AND play_type = p_play_type 
      AND status = 'in_progress'
  ) THEN
    RETURN QUERY SELECT NULL::UUID, 'already_in_progress'::text;
    RETURN;
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

REVOKE EXECUTE ON FUNCTION public.reserve_gold_keys_for_play(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_gold_keys_for_play(UUID, TEXT, INTEGER) TO service_role;

-- 5. confirm_gold_key_reservation
CREATE OR REPLACE FUNCTION public.confirm_gold_key_reservation(
  p_reservation_id UUID
) RETURNS TABLE (
  success BOOLEAN,
  header_id UUID,
  reason TEXT
) AS $$
DECLARE
  v_child_id UUID;
  v_status TEXT;
  v_keys_needed INTEGER;
  v_play_type TEXT;
  v_header_id UUID;
BEGIN
  SELECT child_id, status, keys_needed, play_type 
  INTO v_child_id, v_status, v_keys_needed, v_play_type
  FROM gold_key_reservations
  WHERE id = p_reservation_id;

  IF v_child_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::UUID, 'not_found'::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_child_id::text));

  -- 재조회 및 락
  SELECT status INTO v_status
  FROM gold_key_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_status <> 'reserved' THEN
    RETURN QUERY SELECT false, NULL::UUID, 'invalid_status'::text;
    RETURN;
  END IF;

  -- 소비 헤더 생성 (gold_key_consumptions)
  INSERT INTO gold_key_consumptions (child_id, play_session_id, idempotency_key, requested_count, consumed_count, status)
  VALUES (v_child_id, NULL, 'reserve_confirm_' || p_reservation_id::text, v_keys_needed, v_keys_needed, 'completed')
  RETURNING id INTO v_header_id;

  -- 열쇠 실제 소비 확정
  UPDATE gold_key_ledger
  SET consumed = true, consumed_at = now()
  WHERE reserved_by_reservation_id = p_reservation_id AND consumed = false;

  -- 예약 상태 변경
  UPDATE gold_key_reservations
  SET status = 'confirmed', updated_at = now()
  WHERE id = p_reservation_id;

  RETURN QUERY SELECT true, v_header_id, 'ok'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.confirm_gold_key_reservation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_gold_key_reservation(UUID) TO service_role;

-- 6. restore_gold_key_reservation
CREATE OR REPLACE FUNCTION public.restore_gold_key_reservation(
  p_reservation_id UUID
) RETURNS TABLE (
  success BOOLEAN,
  reason TEXT
) AS $$
DECLARE
  v_child_id UUID;
  v_status TEXT;
BEGIN
  SELECT child_id INTO v_child_id
  FROM gold_key_reservations
  WHERE id = p_reservation_id;

  IF v_child_id IS NULL THEN
    RETURN QUERY SELECT false, 'not_found'::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_child_id::text));

  SELECT status INTO v_status
  FROM gold_key_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_status <> 'reserved' THEN
    RETURN QUERY SELECT false, 'invalid_status'::text;
    RETURN;
  END IF;

  -- 예약된 열쇠를 원래대로 복원 (예약 ID만 제거)
  UPDATE gold_key_ledger
  SET reserved_by_reservation_id = NULL
  WHERE reserved_by_reservation_id = p_reservation_id AND consumed = false;

  -- 예약 상태 변경
  UPDATE gold_key_reservations
  SET status = 'restored', updated_at = now()
  WHERE id = p_reservation_id;

  RETURN QUERY SELECT true, 'ok'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.restore_gold_key_reservation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_gold_key_reservation(UUID) TO service_role;

-- 7. start_new_play_session
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
