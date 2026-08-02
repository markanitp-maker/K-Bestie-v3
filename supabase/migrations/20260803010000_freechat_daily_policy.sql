-- 자유대화 사용 정책 확정 반영 — app/chat/page.tsx의 MAX_SESSION_TURNS(20턴) 클라이언트
-- 판정은 확정된 서비스 정책에 없던 레거시 제한이었다(하루 누적 아이 발화 수를 세어
-- 재접속할 때마다 즉시 세션을 다시 끊는 버그의 근본 원인). 이를 제거하고, 서버 권위
-- 정책으로 교체한다: 운영 계정 기준 하루 최대 3세션 · 하루 총 사용 30분 · 세션 종료
-- 후 5분 휴식(기존 1분에서 변경). KST 기준 자정에 일일 카운터가 초기화된다.
-- Dev/Preview 배포이거나 child_profiles.is_test_account = true인 계정은 반복 QA를
-- 위해 횟수·시간·휴식 제한을 전부 우회한다(p_is_test_bypass, 앱 서버가 계산해 전달).

ALTER TABLE public.freechat_usage_state
  ADD COLUMN IF NOT EXISTS business_date DATE,
  ADD COLUMN IF NOT EXISTS daily_session_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_used_seconds INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.freechat_kst_business_date()
RETURNS DATE
LANGUAGE sql STABLE
AS $$
  SELECT (now() AT TIME ZONE 'Asia/Seoul')::date;
$$;

-- 일일 카운터를 오늘(KST) 기준으로 필요 시 리셋한다. 새 날짜로 넘어갔으면 진행 중이던
-- active/cooldown 상태도 함께 정리한다(전날 세션이 자정을 넘겨 이어질 수 없음).
CREATE OR REPLACE FUNCTION public._freechat_reset_if_new_day(p_row public.freechat_usage_state)
RETURNS public.freechat_usage_state
LANGUAGE plpgsql
AS $$
DECLARE
  v_today DATE := public.freechat_kst_business_date();
  v_row public.freechat_usage_state := p_row;
BEGIN
  IF v_row.business_date IS DISTINCT FROM v_today THEN
    v_row.business_date := v_today;
    v_row.daily_session_count := 0;
    v_row.daily_used_seconds := 0;
    v_row.status := 'ended';
    v_row.started_at := NULL;
    v_row.session_ends_at := NULL;
    v_row.cooldown_until := NULL;

    UPDATE public.freechat_usage_state
    SET business_date = v_row.business_date,
        daily_session_count = 0,
        daily_used_seconds = 0,
        status = 'ended',
        started_at = NULL,
        session_ends_at = NULL,
        cooldown_until = NULL,
        updated_at = now()
    WHERE child_id = v_row.child_id;
  END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_freechat_usage_state(p_child_id UUID, p_is_test_bypass BOOLEAN DEFAULT false)
RETURNS TABLE(
  status TEXT, started_at TIMESTAMPTZ, session_ends_at TIMESTAMPTZ, cooldown_until TIMESTAMPTZ,
  daily_session_count INTEGER, daily_used_seconds INTEGER, daily_limit_reached BOOLEAN
)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.freechat_usage_state;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('freechat_usage_' || p_child_id::text));

  SELECT * INTO v_row FROM public.freechat_usage_state WHERE freechat_usage_state.child_id = p_child_id;

  IF v_row IS NULL THEN
    RETURN QUERY SELECT 'ended'::TEXT, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, 0, 0, false;
    RETURN;
  END IF;

  v_row := public._freechat_reset_if_new_day(v_row);

  IF v_row.status = 'active' AND now() >= v_row.session_ends_at THEN
    UPDATE public.freechat_usage_state
    SET status = 'cooldown',
        cooldown_until = v_row.session_ends_at + (CASE WHEN p_is_test_bypass THEN interval '0 seconds' ELSE interval '5 minutes' END),
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

  RETURN QUERY SELECT
    v_row.status, v_row.started_at, v_row.session_ends_at, v_row.cooldown_until,
    v_row.daily_session_count, v_row.daily_used_seconds,
    (NOT p_is_test_bypass AND (v_row.daily_session_count >= 3 OR v_row.daily_used_seconds >= 1800));
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.get_freechat_usage_state(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_freechat_usage_state(UUID, BOOLEAN) TO service_role;
-- 구 시그니처(단일 인자) 잔여 호출부가 있으면 즉시 드러나도록 명시적으로 제거한다.
DROP FUNCTION IF EXISTS public.get_freechat_usage_state(UUID);

CREATE OR REPLACE FUNCTION public.start_freechat_session(p_child_id UUID, p_is_test_bypass BOOLEAN DEFAULT false)
RETURNS TABLE(
  allowed BOOLEAN, status TEXT, started_at TIMESTAMPTZ, session_ends_at TIMESTAMPTZ, cooldown_until TIMESTAMPTZ,
  daily_session_count INTEGER, daily_used_seconds INTEGER, daily_limit_reached BOOLEAN
)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.freechat_usage_state;
  v_remaining_seconds INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('freechat_usage_' || p_child_id::text));

  SELECT * INTO v_row FROM public.freechat_usage_state WHERE freechat_usage_state.child_id = p_child_id;

  IF v_row IS NULL THEN
    INSERT INTO public.freechat_usage_state (child_id, status, business_date, daily_session_count, daily_used_seconds, updated_at)
    VALUES (p_child_id, 'ended', public.freechat_kst_business_date(), 0, 0, now())
    RETURNING * INTO v_row;
  ELSE
    v_row := public._freechat_reset_if_new_day(v_row);
  END IF;

  IF v_row.status = 'active' AND now() >= v_row.session_ends_at THEN
    UPDATE public.freechat_usage_state
    SET status = 'cooldown',
        cooldown_until = v_row.session_ends_at + (CASE WHEN p_is_test_bypass THEN interval '0 seconds' ELSE interval '5 minutes' END),
        updated_at = now()
    WHERE freechat_usage_state.child_id = p_child_id
    RETURNING * INTO v_row;
  END IF;

  IF v_row.status = 'cooldown' AND now() >= v_row.cooldown_until THEN
    v_row.status := 'ended';
  END IF;

  -- 이미 활성 세션이면 그대로 재개(다중 기기/재접속 시 동일 세션 유지)
  IF v_row.status = 'active' THEN
    RETURN QUERY SELECT true, v_row.status, v_row.started_at, v_row.session_ends_at, v_row.cooldown_until,
      v_row.daily_session_count, v_row.daily_used_seconds, false;
    RETURN;
  END IF;

  IF v_row.status = 'cooldown' THEN
    RETURN QUERY SELECT false, v_row.status, v_row.started_at, v_row.session_ends_at, v_row.cooldown_until,
      v_row.daily_session_count, v_row.daily_used_seconds,
      (NOT p_is_test_bypass AND (v_row.daily_session_count >= 3 OR v_row.daily_used_seconds >= 1800));
    RETURN;
  END IF;

  -- status = 'ended' — 하루 한도(횟수/총시간) 확인. 테스트 계정/Dev는 우회.
  IF NOT p_is_test_bypass AND (v_row.daily_session_count >= 3 OR v_row.daily_used_seconds >= 1800) THEN
    RETURN QUERY SELECT false, 'ended'::TEXT, v_row.started_at, v_row.session_ends_at, v_row.cooldown_until,
      v_row.daily_session_count, v_row.daily_used_seconds, true;
    RETURN;
  END IF;

  v_remaining_seconds := CASE WHEN p_is_test_bypass THEN 1800 ELSE GREATEST(60, 1800 - v_row.daily_used_seconds) END;

  UPDATE public.freechat_usage_state
  SET status = 'active',
      started_at = now(),
      session_ends_at = now() + make_interval(secs => v_remaining_seconds),
      cooldown_until = NULL,
      daily_session_count = v_row.daily_session_count + 1,
      updated_at = now()
  WHERE freechat_usage_state.child_id = p_child_id
  RETURNING * INTO v_row;

  RETURN QUERY SELECT true, v_row.status, v_row.started_at, v_row.session_ends_at, v_row.cooldown_until,
    v_row.daily_session_count, v_row.daily_used_seconds, false;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.start_freechat_session(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_freechat_session(UUID, BOOLEAN) TO service_role;
DROP FUNCTION IF EXISTS public.start_freechat_session(UUID);

CREATE OR REPLACE FUNCTION public.end_freechat_session(p_child_id UUID, p_started_at TIMESTAMPTZ, p_is_test_bypass BOOLEAN DEFAULT false)
RETURNS TABLE(
  status TEXT, cooldown_until TIMESTAMPTZ,
  daily_session_count INTEGER, daily_used_seconds INTEGER, daily_limit_reached BOOLEAN
)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.freechat_usage_state;
  v_elapsed_seconds INTEGER;
  v_new_used_seconds INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('freechat_usage_' || p_child_id::text));

  SELECT * INTO v_row FROM public.freechat_usage_state WHERE freechat_usage_state.child_id = p_child_id;

  IF v_row IS NULL THEN
    RETURN QUERY SELECT 'ended'::TEXT, NULL::TIMESTAMPTZ, 0, 0, false;
    RETURN;
  END IF;

  v_row := public._freechat_reset_if_new_day(v_row);

  IF v_row.status != 'active' OR v_row.started_at != p_started_at THEN
    RETURN QUERY SELECT v_row.status, v_row.cooldown_until, v_row.daily_session_count, v_row.daily_used_seconds,
      (NOT p_is_test_bypass AND (v_row.daily_session_count >= 3 OR v_row.daily_used_seconds >= 1800));
    RETURN;
  END IF;

  v_elapsed_seconds := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_row.started_at))::INTEGER);
  v_new_used_seconds := v_row.daily_used_seconds + v_elapsed_seconds;

  UPDATE public.freechat_usage_state
  SET status = CASE WHEN p_is_test_bypass THEN 'ended' ELSE 'cooldown' END,
      cooldown_until = CASE WHEN p_is_test_bypass THEN NULL ELSE now() + interval '5 minutes' END,
      daily_used_seconds = v_new_used_seconds,
      updated_at = now()
  WHERE freechat_usage_state.child_id = p_child_id
  RETURNING * INTO v_row;

  RETURN QUERY SELECT v_row.status, v_row.cooldown_until, v_row.daily_session_count, v_row.daily_used_seconds,
    (NOT p_is_test_bypass AND (v_row.daily_session_count >= 3 OR v_row.daily_used_seconds >= 1800));
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.end_freechat_session(UUID, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_freechat_session(UUID, TIMESTAMPTZ, BOOLEAN) TO service_role;
DROP FUNCTION IF EXISTS public.end_freechat_session(UUID, TIMESTAMPTZ);
