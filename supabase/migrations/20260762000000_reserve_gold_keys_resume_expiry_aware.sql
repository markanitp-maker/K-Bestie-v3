-- 실측 버그 수정: reserve_gold_keys_for_play의 "이미 진행중" 판정이 status='in_progress'만
-- 보고 resume_expires_at 만료를 전혀 고려하지 않았다. 그 결과 /api/play/session(이어하기
-- 가능 여부, resume_expires_at 만료를 실제로 반영)은 "이어하기 불가"라 판단해 UI가
-- "시작하기" 버튼을 보여주는데, 정작 reserve RPC는 여전히 already_in_progress(409)를
-- 반환해 MBTI 등에서 "놀이 예약에 실패했습니다" 알럿으로 막다른 길에 도달했다
-- (실측: 2026-07-27, k_play_sessions에 실제로 이런 상태의 행 다수 확인).
--
-- 수정 방향: 이어하기 기간(resume_expires_at)이 아직 남아있는 실제 진행 세션만
-- already_in_progress로 차단한다. 기간이 지났지만 status가 아직 in_progress인 세션은
-- 같은 트랜잭션 안에서 기존 스키마가 허용하는 'expired' 상태로 전환한 뒤 신규 예약을
-- 계속 진행한다. 그 세션에 딸린 예약이 이미 confirm(소비 확정)된 경우는 환급하지 않고,
-- reserve만 되고 confirm되지 않은 경우(예: MBTI 티켓이 exchange까지만 되고 ready에
-- 도달하지 못한 경우)만 기존 restore_gold_key_reservation 정책으로 복구한다.
--
-- p_is_restart=true(명시적 "초기화하기" 재시작 확인 흐름, /api/play/restart)는 건드리지
-- 않는다 — 그 경로는 원래도 already_in_progress 체크를 건너뛰고 start_new_play_session이
-- 기존 세션을 그대로 재사용(progress_state 리셋)하므로 동작이 달라지면 안 된다.

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

  -- 락 획득 (원자성, 동시성 안전)
  PERFORM pg_advisory_xact_lock(hashtext(p_child_id::text));

  IF p_is_restart = false THEN
    -- 이어하기 기간이 아직 남아있는(또는 resume_expires_at이 없어 무기한인) 실제 진행
    -- 세션만 차단한다. resume_expires_at이 NULL이면 만료 없음으로 취급한다(/api/play/session의
    -- canResume 계산과 동일한 규칙).
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

    -- 이어하기 기간은 지났지만 status가 아직 in_progress로 남은 세션 정리.
    SELECT id INTO v_stale_session_id
    FROM k_play_sessions
    WHERE child_id = p_child_id
      AND play_type = p_play_type
      AND status = 'in_progress'
      AND resume_expires_at IS NOT NULL
      AND resume_expires_at <= now()
    FOR UPDATE;

    IF v_stale_session_id IS NOT NULL THEN
      -- 이 child+play_type에 대해 아직 confirm/restore되지 않은(reserved) 예약이 남아있으면
      -- 전부 복구한다 — confirm된 예약은 이 루프에 걸리지 않으므로(status='confirmed') 절대
      -- 환급되지 않는다.
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
  END IF;

  -- 예약 가능한 열쇠 선별 (지급시각 오름차순 FIFO) — 기존 로직 그대로.
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
