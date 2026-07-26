-- 일회성 데이터 정리: 20260762000000에서 고친 reserve_gold_keys_for_play 버그 때문에
-- 이미 DB에 남아있는, "이어하기 기간(resume_expires_at)은 지났지만 status는 여전히
-- in_progress"인 세션들을 동일한 기준으로 정리한다. 물리 삭제하지 않고 기존 스키마가
-- 허용하는 'expired' 상태로 전환만 한다. 대상은 mbti뿐 아니라 같은 RPC를 공유하는
-- comic_book/quiz/hairstyle도 포함해 전체 놀이 타입을 대상으로 한다.
--
-- 이 스크립트는 멱등적이다 — 조건에 맞는 행이 이미 없으면 아무 것도 하지 않는다.

DO $$
DECLARE
  v_row RECORD;
  v_reservation_id UUID;
BEGIN
  FOR v_row IN
    SELECT id, child_id, play_type
    FROM k_play_sessions
    WHERE status = 'in_progress'
      AND resume_expires_at IS NOT NULL
      AND resume_expires_at <= now()
    FOR UPDATE
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext(v_row.child_id::text));

    -- confirm되지 않고 남아있는(reserved) 예약만 복구한다 — 이미 confirm된 예약은
    -- status='confirmed'라 이 조건에 걸리지 않으므로 환급되지 않는다.
    FOR v_reservation_id IN
      SELECT id FROM gold_key_reservations
      WHERE child_id = v_row.child_id AND play_type = v_row.play_type AND status = 'reserved'
      FOR UPDATE
    LOOP
      PERFORM public.restore_gold_key_reservation(v_reservation_id);
    END LOOP;

    UPDATE k_play_sessions
    SET status = 'expired', updated_at = now()
    WHERE id = v_row.id;

    RAISE NOTICE '[cleanup] expired stale in_progress session % (child=%, play_type=%)',
      v_row.id, v_row.child_id, v_row.play_type;
  END LOOP;
END $$;
