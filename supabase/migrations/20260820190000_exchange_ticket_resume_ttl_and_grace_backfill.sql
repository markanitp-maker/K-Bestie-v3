-- K-Toon 통합 마이그레이션 B — 티켓 교환 시 resume_expires_at 설정 + grace backfill
--
-- 배경 (2026-08-20 READ-ONLY 실측, logs/D1-ttl-census.log):
--   exchange_play_execution_ticket 의 k_play_sessions INSERT 는 resume_expires_at 을
--   컬럼 목록에 넣지 않아 NULL 로 남긴다. 그런데 살아있는 코드는 NULL 을 "만료 없음"으로
--   읽는다(api/play/session/route.ts:81-84, 20260805190000:139,155).
--   결과: dev/prod 양쪽 MBTI 세션 전 건이 NULL 이고, 17일 된 세션이 아직 in_progress 다.
--   "6시간 이어하기"는 주석과 호출자 0건인 sessionAuth.ts 에만 존재했다.
--
--   이 파일이 그 한 줄을 고친다. TTL 값은 마이그레이션 A 가 넣은
--   play_registry.resume_ttl_hours 에서 읽는다 (mbti=6, comic_book=5).
--
-- 승인 (D1, 2026-08-20):
--   MBTI 의 관측 동작이 "무기한 → 6시간"으로 바뀌는 것을 의도된 버그 수정으로 승인받았다.
--   기존 활성 세션을 배포 즉시 끊지 않도록 grace backfill 을 함께 적용한다.
--
-- 범위 제한:
--   수정 함수는 exchange_play_execution_ticket 하나뿐이다.
--   reserve_gold_keys_for_play / start_new_play_session / consume_play_access 는
--   티켓 경로에서 호출되지 않으므로 건드리지 않는다. 특히
--   reserve_gold_keys_for_play 의 활성 정의(20260805190000)는 황금열쇠 이중 차감 가드다.
--
-- 선행: 20260820180000 (play_registry.resume_ttl_hours)
-- 정본 계약: docs/ops/integration-contract.md §1 "resume TTL 계약"

-- ================================================================
-- 0. 선행 마이그레이션 확인
-- ================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'play_registry'
      AND column_name = 'resume_ttl_hours'
  ) THEN
    RAISE EXCEPTION 'play_registry.resume_ttl_hours 가 없다. 20260820180000 을 먼저 적용하라.';
  END IF;
END $$;

-- ================================================================
-- 1. exchange_play_execution_ticket — INSERT 에 resume_expires_at 추가
-- ================================================================
-- 20260761000000 본문을 그대로 두고 INSERT 절만 바꾼다. 로직 변경 없음.
-- pr 별칭이 이미 FROM 절에 있어 조인 추가가 필요 없다.
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

  -- k_play_sessions에 별칭(kps)을 붙여 OUT 파라미터 progress_state와 구분(20260761000000)
  SELECT kps.id, kps.progress_state INTO v_session_id, v_progress_state
  FROM k_play_sessions kps
  WHERE kps.child_id = v_ticket.child_id AND kps.play_type = v_ticket.play_id AND kps.status = 'in_progress'
  FOR UPDATE;

  IF v_session_id IS NULL THEN
    -- 변경점 ① resume_expires_at 을 레지스트리 TTL 로 설정한다.
    --   이 값이 NULL 이면 시스템 전체가 "만료 없음"으로 읽어 이어하기가 무기한이 된다.
    -- 변경점 ② expires_at 을 6시간 → 24시간으로 정정한다.
    --   레거시 경로(start_new_play_session)가 이미 24시간을 쓰고 있어 의미를 맞춘다.
    --   이어하기 판정에 쓰이는 값은 resume_expires_at 이다.
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

-- ================================================================
-- 2. Grace backfill — 기존 활성 NULL 세션을 즉시 끊지 않는다
-- ================================================================
-- 실측상 활성 NULL 세션은 전부 이미 6시간을 넘겼다(최고령 17일). 정상 TTL 을 그대로
-- 적용하면 배포 즉시 만료가 된다. 읽고 있던 사용자를 끊지 않도록 grace 를 준다.
--
--   GREATEST(정상 만료시각, now() + 6시간)
--     · 정상 창 안의 세션 → 원래 만료 시각을 그대로 받는다
--     · 이미 창을 넘긴 세션 → 배포 시점 +6시간을 받고, 이후 기존 lazy 만료 경로
--       (reserve_gold_keys_for_play, 20260763000000 정리 잡)로 자연 종료된다
--
-- terminal 행(completed/expired/refunded)은 건드리지 않는다. 읽는 코드가 없어
-- 행동 변화가 없고 blast radius 만 커진다.
UPDATE k_play_sessions ks
SET resume_expires_at = GREATEST(
      ks.started_at + make_interval(hours => pr.resume_ttl_hours),
      now() + interval '6 hours'
    )
FROM play_registry pr
WHERE pr.play_id = ks.play_type
  AND ks.status = 'in_progress'
  AND ks.resume_expires_at IS NULL;

-- ================================================================
-- 3. 검증
-- ================================================================
DO $$
DECLARE
  v_null_active INTEGER;
  v_expiring_now INTEGER;
  v_src TEXT;
BEGIN
  -- 활성 세션 중 NULL 이 남아 있으면 안 된다
  SELECT count(*) INTO v_null_active
  FROM k_play_sessions
  WHERE status = 'in_progress' AND resume_expires_at IS NULL;
  IF v_null_active > 0 THEN
    RAISE EXCEPTION 'backfill 후에도 resume_expires_at 이 NULL 인 활성 세션이 % 건 남았다', v_null_active;
  END IF;

  -- grace 보장: 활성 세션이 즉시 만료되면 안 된다
  SELECT count(*) INTO v_expiring_now
  FROM k_play_sessions
  WHERE status = 'in_progress' AND resume_expires_at <= now();
  IF v_expiring_now > 0 THEN
    RAISE EXCEPTION 'grace 실패 — 즉시 만료되는 활성 세션이 % 건이다', v_expiring_now;
  END IF;

  -- 함수가 실제로 레지스트리 TTL 을 참조하는지 확인
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'exchange_play_execution_ticket';
  IF v_src NOT LIKE '%resume_ttl_hours%' THEN
    RAISE EXCEPTION 'exchange_play_execution_ticket 이 resume_ttl_hours 를 참조하지 않는다';
  END IF;
  IF v_src LIKE '%interval ''6 hours''%' THEN
    RAISE EXCEPTION 'exchange_play_execution_ticket 에 6시간 하드코딩이 남아 있다';
  END IF;
END $$;
