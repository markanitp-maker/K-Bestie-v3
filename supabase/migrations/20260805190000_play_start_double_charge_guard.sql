-- requests/023-play-resume-new-start-modal.md — "새로 시작하기" 황금열쇠 중복 차감 방지
--
-- 배경(코드/스키마 실측으로 확인한 두 개의 실제 구멍):
--
--  ① MBTI(k_play_sessions 계열): reserve_gold_keys_for_play는 child_id advisory lock
--     안에서 동작하지만, 예약(gold_key_reservations) 자체에는 유일성 제약이 없다.
--     - mode=start  : "이미 in_progress 세션이 있는가" 만 본다. 그런데 세션은 confirm
--                     시점에야 생기므로, 예약만 된 상태에서 들어온 두 번째 클릭은
--                     그 검사를 그대로 통과해 **두 번째 예약**을 만든다.
--     - mode=restart: 20260805174505에서 위 검사 자체를 건너뛰도록 바뀌어(재시작은 기존
--                     세션을 종료해야 하므로 의도된 변경) 중복 예약이 더 쉽게 만들어진다.
--     예약이 2개면 나중에 confirm이 2번 성공해 **비용이 2배 차감**된다.
--
--  ② 퀴즈마스터(quiz_attempts 계열): lib/quiz/handoffToken.ts가 consumeKeys()를 쓰는데
--     이 헬퍼는 호출마다 난수 idempotency_key를 만든다(파일 주석에 명시). 즉 세션 앵커가
--     아예 없어 더블클릭/다중 탭이면 그대로 2회 차감된다.
--
-- 이 마이그레이션은 두 경로 각각에 "동시에 하나만" 을 DB 레벨에서 보장하는 앵커를 만든다.
-- 어느 쪽도 기존 세션/원장을 물리 삭제하지 않으며, completion/refund 콜백 계약
-- (confirm_gold_key_reservation / refund_gold_keys_by_consumption_id / quiz 완료·환불
-- 라우트)은 시그니처·의미 모두 그대로 둔다.

-- ================================================================
-- 1. gold_key_reservations: (child_id, play_type) 당 미결 예약 1건 유일성
-- ================================================================
-- 인덱스를 만들기 전에, 과거에 만들어졌을 수 있는 중복 미결 예약을 정리한다.
-- 물리 삭제가 아니라 restore_gold_key_reservation()으로 되돌린다 —
-- 예약된 원장 행의 reserved_by_reservation_id만 풀고 예약을 'restored'로 남긴다.
DO $$
DECLARE
  v_id UUID;
BEGIN
  FOR v_id IN
    SELECT id FROM (
      SELECT id,
             row_number() OVER (
               PARTITION BY child_id, play_type ORDER BY created_at DESC, id DESC
             ) AS rn
      FROM gold_key_reservations
      WHERE status = 'reserved'
    ) ranked
    WHERE rn > 1
  LOOP
    PERFORM public.restore_gold_key_reservation(v_id);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_gold_key_reservations_one_open
  ON gold_key_reservations (child_id, play_type)
  WHERE status = 'reserved';

COMMENT ON INDEX uidx_gold_key_reservations_one_open IS
  '아이×놀이당 미결(reserved) 예약은 항상 1건. 더블클릭/다중 탭이 두 번째 예약을 만들어
   나중에 confirm이 2번 성공하는 이중 차감을 DB 레벨에서 차단한다.
   reserve_gold_keys_for_play가 기존 예약을 재사용하므로 정상 경로에서는 이 인덱스가
   발동하지 않는다 — 어떤 호출부가 advisory lock 없이 들어와도 무너지지 않게 하는 방어선.';

-- ================================================================
-- 2. reserve_gold_keys_for_play — 미결 예약 재사용(멱등) + 재시작 세션 종료 보장
-- ================================================================
-- 20260805174505 대비 변경점:
--   (a) 오래된 미결 예약(고아)을 먼저 복원해 영구 잠김을 막는다.
--   (b) 미결 예약이 남아 있으면 **새로 만들지 않고 그 예약 id를 그대로 돌려준다.**
--       → 더블클릭/다중 탭은 같은 예약을 공유하고, confirm은 예약 단위로 멱등하므로
--         (status<>'reserved'면 invalid_status) 차감은 정확히 1회다.
--   (c) 재사용 경로에서도 restart면 기존 in_progress 세션 종료를 다시 보장한다(멱등).
--       exchange_play_execution_ticket이 in_progress 세션을 재사용하기 때문에, 이걸
--       빠뜨리면 "새로 시작하기"가 옛 progress_state를 그대로 이어받는다.
--   (d) 열쇠 확보에 성공한 뒤에만 기존 세션을 종료하는 순서는 그대로 유지한다
--       (잔액 부족으로 실패했는데 진행 내용만 날아가는 상황 방지).
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
  v_reuse_id UUID;
  v_orphan_id UUID;
BEGIN
  IF p_keys_needed IS NULL OR p_keys_needed <= 0 THEN
    RETURN QUERY SELECT NULL::UUID, 'invalid_amount'::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_child_id::text));

  -- (a) 고아 예약 복원. 정상 흐름의 미결 예약 수명은 실행 티켓 TTL(90초) + ready
  -- 타임아웃(30초) 안쪽이므로, 5분을 넘긴 미결 예약은 시작이 끝내 완료되지 않은 것이다.
  -- 그대로 두면 (b)의 재사용이 영구히 같은 예약을 붙잡아 놀이를 못 하게 된다.
  FOR v_orphan_id IN
    SELECT id FROM gold_key_reservations
    WHERE child_id = p_child_id
      AND play_type = p_play_type
      AND status = 'reserved'
      AND created_at <= now() - interval '5 minutes'
    FOR UPDATE
  LOOP
    PERFORM public.restore_gold_key_reservation(v_orphan_id);
  END LOOP;

  -- (b) 진행 중인 시작 요청이 이미 있으면 같은 예약을 돌려준다(중복 차감 방지의 핵심).
  SELECT id INTO v_reuse_id
  FROM gold_key_reservations
  WHERE child_id = p_child_id
    AND play_type = p_play_type
    AND status = 'reserved'
  FOR UPDATE;

  IF v_reuse_id IS NOT NULL THEN
    -- (c) 재시작이면 기존 세션 종료를 멱등하게 다시 보장한다.
    IF p_is_restart THEN
      UPDATE k_play_sessions
      SET status = 'expired', updated_at = now()
      WHERE child_id = p_child_id
        AND play_type = p_play_type
        AND status = 'in_progress';
    END IF;

    RETURN QUERY SELECT v_reuse_id, 'ok'::text;
    RETURN;
  END IF;

  -- 신규 시작인데 아직 살아있는(이어하기 가능한) 세션이 있으면 거부한다.
  -- 재시작은 이 검사를 건너뛴다 — 종료시키는 것이 목적이기 때문.
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

  -- 종료 대상 세션: 신규 시작이면 이어하기 만료된 것만, 재시작이면 진행 중 전부.
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

  -- (d) 열쇠부터 확보한다. 여기서 실패하면 기존 세션은 손대지 않은 채 반환된다.
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

  -- 열쇠 확보가 확정된 뒤에만 기존 세션을 종료 상태로 전환한다(물리 삭제 아님).
  IF v_stale_session_id IS NOT NULL THEN
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

-- ================================================================
-- 3. play_start_guards — 퀴즈마스터처럼 예약 인프라를 쓰지 않는 놀이의 시작 앵커
-- ================================================================
-- 퀴즈마스터는 k_play_sessions/gold_key_reservations를 의도적으로 쓰지 않고
-- consume_gold_keys로 즉시 차감한다(lib/quiz/handoffToken.ts). 그래서 "시작이 진행 중"
-- 임을 나타낼 행이 어디에도 없다 — 그 앵커를 여기서 만든다.
--
-- 부분 유니크 인덱스가 실제 보증이다: 열려 있는(open) guard는 아이×놀이당 항상 1건.
CREATE TABLE IF NOT EXISTS play_start_guards (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id       UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  play_type      TEXT NOT NULL,
  mode           TEXT NOT NULL CHECK (mode IN ('start', 'restart')),
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'released')),
  consumption_id UUID REFERENCES gold_key_consumptions(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE play_start_guards IS
  '놀이 시작 요청의 중복 차감 방지 앵커(requests/023). 현재 사용처는 퀴즈마스터.
   open 상태인 동안 같은 아이×놀이의 추가 시작 요청을 거부해 더블클릭/다중 탭이
   황금열쇠를 두 번 차감하지 못하게 한다. 세션이나 원장을 대신하지 않는다.';

CREATE UNIQUE INDEX IF NOT EXISTS uidx_play_start_guards_one_open
  ON play_start_guards (child_id, play_type)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_play_start_guards_expiring
  ON play_start_guards (expires_at)
  WHERE status = 'open';

ALTER TABLE play_start_guards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "play_start_guards_service_only"
  ON play_start_guards FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON public.play_start_guards TO anon, authenticated;

-- ================================================================
-- 4. begin_quiz_start_charge — 퀴즈마스터 시작/재시작 1회 차감 보장
-- ================================================================
-- 단일 트랜잭션 안에서 (advisory lock → guard 선점 → 차감 → 기존 attempt 종료)를 모두
-- 처리한다. TS 레이어에 임계 구간이 남지 않는 것이 핵심이다.
--
-- 순서 주의: **차감이 성공한 뒤에** 기존 attempt를 종료한다. 반대로 하면 잔액 부족으로
-- 시작이 실패했는데 진행하던 퀴즈만 사라진다.
--
-- 반환 reason:
--   'ok'                  — 새로 차감했다. consumption_id를 reward_transaction_id로 쓴다.
--   'already_starting'    — 같은 아이×놀이의 시작이 이미 진행 중. 차감하지 않았다.
--   'insufficient_balance'— 열쇠 부족. 차감·종료 모두 일어나지 않았다.
CREATE OR REPLACE FUNCTION public.begin_quiz_start_charge(
  p_child_id UUID,
  p_user_id UUID,
  p_keys_needed INTEGER,
  p_is_restart BOOLEAN DEFAULT false,
  p_ttl_seconds INTEGER DEFAULT 60
) RETURNS TABLE (
  guard_id UUID,
  consumption_id UUID,
  reason TEXT
) AS $$
DECLARE
  v_play_type CONSTANT TEXT := 'quizmaster';
  v_open_id UUID;
  v_guard_id UUID;
  v_consume_success BOOLEAN;
  v_header_id UUID;
  v_consume_reason TEXT;
BEGIN
  IF p_keys_needed IS NULL OR p_keys_needed <= 0 THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'invalid_amount'::text;
    RETURN;
  END IF;

  -- consume_gold_keys와 동일한 락 키를 쓴다(같은 트랜잭션 안에서는 재진입 가능).
  PERFORM pg_advisory_xact_lock(hashtext(p_child_id::text));

  -- 만료된 guard는 닫아준다(물리 삭제 아님 — 이력 보존).
  UPDATE play_start_guards
  SET status = 'released'
  WHERE child_id = p_child_id
    AND play_type = v_play_type
    AND status = 'open'
    AND expires_at <= now();

  SELECT id INTO v_open_id
  FROM play_start_guards
  WHERE child_id = p_child_id
    AND play_type = v_play_type
    AND status = 'open'
  FOR UPDATE;

  IF v_open_id IS NOT NULL THEN
    RETURN QUERY SELECT v_open_id, NULL::UUID, 'already_starting'::text;
    RETURN;
  END IF;

  INSERT INTO play_start_guards (child_id, play_type, mode, status, expires_at)
  VALUES (
    p_child_id,
    v_play_type,
    CASE WHEN p_is_restart THEN 'restart' ELSE 'start' END,
    'open',
    now() + make_interval(secs => p_ttl_seconds)
  )
  RETURNING id INTO v_guard_id;

  SELECT cgk.success, cgk.header_id, cgk.reason
  INTO v_consume_success, v_header_id, v_consume_reason
  FROM public.consume_gold_keys(
    p_child_id,
    p_keys_needed,
    'quiz_start:' || v_guard_id::text,
    NULL::UUID
  ) cgk;

  IF NOT v_consume_success THEN
    -- 차감 실패 — guard를 즉시 풀어 다음 시도를 막지 않는다. attempt는 손대지 않았다.
    UPDATE play_start_guards SET status = 'released' WHERE id = v_guard_id;
    RETURN QUERY SELECT v_guard_id, NULL::UUID, COALESCE(v_consume_reason, 'consume_failed')::text;
    RETURN;
  END IF;

  -- 차감 확정 후에만 기존 진행 attempt를 종료 상태로 전환한다.
  -- quiz_attempts.status CHECK에 'abandoned'는 없다(실측: in_progress/background/
  -- disconnected/submitted/expired). 이어하기 판정(app/api/play/session)이 보는
  -- in_progress·background에서 빠지는 'expired'가 이 스키마에서의 정상 종료 상태다.
  -- 행은 남으므로 이력·원장은 그대로 보존된다.
  IF p_is_restart THEN
    UPDATE quiz_attempts
    SET status = 'expired'
    WHERE user_id = p_user_id
      AND status IN ('in_progress', 'background');
  END IF;

  UPDATE play_start_guards
  SET consumption_id = v_header_id
  WHERE id = v_guard_id;

  RETURN QUERY SELECT v_guard_id, v_header_id, 'ok'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.begin_quiz_start_charge(UUID, UUID, INTEGER, BOOLEAN, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_quiz_start_charge(UUID, UUID, INTEGER, BOOLEAN, INTEGER) TO service_role;

-- ================================================================
-- 5. release_play_start_guard — 시작이 확정 실패했을 때 guard 해제
-- ================================================================
-- handoff token 발급이 실패해 보상 환불을 한 경우, guard를 TTL까지 붙잡아 둘 이유가 없다.
CREATE OR REPLACE FUNCTION public.release_play_start_guard(
  p_guard_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE play_start_guards
  SET status = 'released'
  WHERE id = p_guard_id AND status = 'open';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.release_play_start_guard(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_play_start_guard(UUID) TO service_role;
