-- 자유대화 사용 정책 최종 확정(대표님 2026-08-02 긴급 지시) — 하루 이용 횟수/시간 제한
-- 없음, 아이 발화 턴 제한 없음, 세션당 최대 10분, 실제 10분 세션 종료 후에만 1분 휴식,
-- 휴식 만료 즉시 재진입 가능. 이전 리비전(같은 파일명)에서 시도했던 "하루 3세션·30분"
-- 정책은 확정된 정책이 아니었으므로 전량 되돌린다 — 원래(20260777000000) 10분/1분
-- 설계로 복귀하되, Dev/Preview 또는 is_test_account=true 계정은 반복 QA를 위해 세션
-- 시간·휴식을 전부 우회하는 p_is_test_bypass 파라미터만 추가로 유지한다.
--
-- 이 마이그레이션은 Production에 우발적으로 배포된 2-인자 RPC 호출과 스키마를
-- 맞추기 위해 Dev/Production 동일 적용이 시급하다(PGRST202: 함수를 찾을 수 없음
-- 오류로 /chat 진입 시 요청이 전부 500 실패 → 클라이언트가 이를 "휴식 중"으로
-- 잘못 해석해 무한 휴식 화면처럼 보였다).

ALTER TABLE public.freechat_usage_state
  DROP COLUMN IF EXISTS business_date,
  DROP COLUMN IF EXISTS daily_session_count,
  DROP COLUMN IF EXISTS daily_used_seconds;

DROP FUNCTION IF EXISTS public.get_freechat_usage_state(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.get_freechat_usage_state(UUID);
DROP FUNCTION IF EXISTS public.start_freechat_session(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.start_freechat_session(UUID);
DROP FUNCTION IF EXISTS public.end_freechat_session(UUID, TIMESTAMPTZ, BOOLEAN);
DROP FUNCTION IF EXISTS public.end_freechat_session(UUID, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public._freechat_reset_if_new_day(public.freechat_usage_state);
DROP FUNCTION IF EXISTS public.freechat_kst_business_date();

CREATE OR REPLACE FUNCTION public.get_freechat_usage_state(p_child_id UUID, p_is_test_bypass BOOLEAN DEFAULT false)
RETURNS TABLE(status TEXT, started_at TIMESTAMPTZ, session_ends_at TIMESTAMPTZ, cooldown_until TIMESTAMPTZ)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.freechat_usage_state;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('freechat_usage_' || p_child_id::text));

  SELECT * INTO v_row FROM public.freechat_usage_state WHERE freechat_usage_state.child_id = p_child_id;

  IF v_row IS NULL THEN
    RETURN QUERY SELECT 'ended'::TEXT, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_row.status = 'active' AND now() >= v_row.session_ends_at THEN
    UPDATE public.freechat_usage_state
    SET status = 'cooldown',
        cooldown_until = v_row.session_ends_at + (CASE WHEN p_is_test_bypass THEN interval '0 seconds' ELSE interval '1 minute' END),
        updated_at = now()
    WHERE freechat_usage_state.child_id = p_child_id
    RETURNING * INTO v_row;
  END IF;

  IF v_row.status = 'cooldown' AND now() >= v_row.cooldown_until THEN
    UPDATE public.freechat_usage_state
    SET status = 'ended', updated_at = now()
    WHERE freechat_usage_state.child_id = p_child_id
    RETURNING * INTO v_row;
  END IF;

  RETURN QUERY SELECT v_row.status, v_row.started_at, v_row.session_ends_at, v_row.cooldown_until;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.get_freechat_usage_state(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_freechat_usage_state(UUID, BOOLEAN) TO service_role;

-- 세션 시작: 이미 활성 세션이면 그대로 재개(다중 기기 동시 사용 방지), 휴식 중이면
-- 거부, 그 외(신규/만료됨)면 새 10분 세션을 원자적으로 생성한다. 하루 횟수·총시간
-- 제한 없음 — 오직 "지금 이 순간 활성 세션이 있는가/휴식 중인가"만 본다.
CREATE OR REPLACE FUNCTION public.start_freechat_session(p_child_id UUID, p_is_test_bypass BOOLEAN DEFAULT false)
RETURNS TABLE(allowed BOOLEAN, status TEXT, started_at TIMESTAMPTZ, session_ends_at TIMESTAMPTZ, cooldown_until TIMESTAMPTZ)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.freechat_usage_state;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('freechat_usage_' || p_child_id::text));

  SELECT * INTO v_row FROM public.freechat_usage_state WHERE freechat_usage_state.child_id = p_child_id;

  IF v_row IS NULL THEN
    INSERT INTO public.freechat_usage_state (child_id, status, started_at, session_ends_at, cooldown_until, updated_at)
    VALUES (p_child_id, 'active', now(), now() + interval '10 minutes', NULL, now())
    RETURNING * INTO v_row;
    RETURN QUERY SELECT true, v_row.status, v_row.started_at, v_row.session_ends_at, v_row.cooldown_until;
    RETURN;
  END IF;

  IF v_row.status = 'active' AND now() >= v_row.session_ends_at THEN
    UPDATE public.freechat_usage_state
    SET status = 'cooldown',
        cooldown_until = v_row.session_ends_at + (CASE WHEN p_is_test_bypass THEN interval '0 seconds' ELSE interval '1 minute' END),
        updated_at = now()
    WHERE freechat_usage_state.child_id = p_child_id
    RETURNING * INTO v_row;
  END IF;

  IF v_row.status = 'cooldown' AND now() >= v_row.cooldown_until THEN
    v_row.status := 'ended';
  END IF;

  IF v_row.status = 'active' THEN
    RETURN QUERY SELECT true, v_row.status, v_row.started_at, v_row.session_ends_at, v_row.cooldown_until;
    RETURN;
  END IF;

  IF v_row.status = 'cooldown' THEN
    RETURN QUERY SELECT false, v_row.status, v_row.started_at, v_row.session_ends_at, v_row.cooldown_until;
    RETURN;
  END IF;

  UPDATE public.freechat_usage_state
  SET status = 'active', started_at = now(), session_ends_at = now() + interval '10 minutes', cooldown_until = NULL, updated_at = now()
  WHERE freechat_usage_state.child_id = p_child_id
  RETURNING * INTO v_row;

  RETURN QUERY SELECT true, v_row.status, v_row.started_at, v_row.session_ends_at, v_row.cooldown_until;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.start_freechat_session(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_freechat_session(UUID, BOOLEAN) TO service_role;

-- 세션 종료: 실제로 활성 세션이 자연 만료(now() >= session_ends_at, 즉 진짜 10분을
-- 다 채운 경우)로 끝났을 때만 1분 휴식을 부과한다. 10분이 되기 전에(홈으로 나가기 등)
-- 클라이언트가 조기 종료를 요청하면 휴식 없이 바로 'ended'로 전환한다 — 다음 진입이
-- 즉시 허용된다. p_started_at으로 "지금 끝내려는 세션이 실제로 그 세션이 맞는지"를
-- 확인해 이미 다른 이유로 종료·갱신된 세션을 잘못 다시 cooldown 처리하지 않는다(멱등).
CREATE OR REPLACE FUNCTION public.end_freechat_session(p_child_id UUID, p_started_at TIMESTAMPTZ, p_is_test_bypass BOOLEAN DEFAULT false)
RETURNS TABLE(status TEXT, cooldown_until TIMESTAMPTZ)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.freechat_usage_state;
  v_naturally_expired BOOLEAN;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('freechat_usage_' || p_child_id::text));

  SELECT * INTO v_row FROM public.freechat_usage_state WHERE freechat_usage_state.child_id = p_child_id;

  IF v_row IS NULL THEN
    RETURN QUERY SELECT 'ended'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_row.status != 'active' OR v_row.started_at != p_started_at THEN
    RETURN QUERY SELECT v_row.status, v_row.cooldown_until;
    RETURN;
  END IF;

  -- 실제로 10분을 다 채워 자연 만료된 경우에만 휴식을 부과한다(조기 종료는 휴식 없음).
  v_naturally_expired := now() >= v_row.session_ends_at;

  UPDATE public.freechat_usage_state
  SET status = CASE WHEN v_naturally_expired AND NOT p_is_test_bypass THEN 'cooldown' ELSE 'ended' END,
      cooldown_until = CASE WHEN v_naturally_expired AND NOT p_is_test_bypass THEN v_row.session_ends_at + interval '1 minute' ELSE NULL END,
      updated_at = now()
  WHERE freechat_usage_state.child_id = p_child_id
  RETURNING * INTO v_row;

  RETURN QUERY SELECT v_row.status, v_row.cooldown_until;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.end_freechat_session(UUID, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_freechat_session(UUID, TIMESTAMPTZ, BOOLEAN) TO service_role;
