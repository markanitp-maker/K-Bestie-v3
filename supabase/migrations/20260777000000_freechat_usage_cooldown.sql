-- requests/030-freechat-timer.md — 자유대화 10분 연속 사용 후 1분 휴식 제한을
-- 클라이언트 setTimeout이 아니라 서버 시간 기준으로 강제한다. child_id당 1행만
-- 유지하며(현재 진행 중이거나 가장 최근 사용 상태만 필요, 이력 보존 불필요),
-- get_or_create_chat_session/create_plan_change_request와 동일하게
-- advisory lock + SECURITY DEFINER RPC로 원자적 상태전이를 보장한다.

CREATE TABLE IF NOT EXISTS public.freechat_usage_state (
  child_id          UUID PRIMARY KEY REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'ended'
                       CHECK (status IN ('active', 'cooldown', 'ended')),
  started_at        TIMESTAMPTZ,
  session_ends_at   TIMESTAMPTZ,
  cooldown_until    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.freechat_usage_state ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.freechat_usage_state TO anon, authenticated;

-- 이 테이블은 parent_questions/admin_audit_log와 동일하게 service_role 경유
-- (서버 API + requireChildAccess 인가 완료 후) 전용으로만 쓴다.
CREATE POLICY "freechat_usage_state_service_all"
  ON public.freechat_usage_state FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 조회 전용: active/cooldown 만료를 서버 시간 기준으로 지연 전이(lazy transition)한
-- 뒤 현재 상태를 반환한다. 클라이언트가 새로고침/재접속/다른 기기에서 상태를
-- 물어봐도 항상 이 함수를 거치므로 결과가 일관된다.
CREATE OR REPLACE FUNCTION public.get_freechat_usage_state(p_child_id UUID)
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
    SET status = 'cooldown', cooldown_until = v_row.session_ends_at + interval '1 minute', updated_at = now()
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

REVOKE EXECUTE ON FUNCTION public.get_freechat_usage_state(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_freechat_usage_state(UUID) TO service_role;

-- 세션 시작: 이미 활성 세션이면 그대로 재개(다중 기기 동시 사용 방지), 휴식
-- 중이면 거부, 그 외(신규/만료됨)면 새 10분 세션을 원자적으로 생성한다.
CREATE OR REPLACE FUNCTION public.start_freechat_session(p_child_id UUID)
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
    SET status = 'cooldown', cooldown_until = v_row.session_ends_at + interval '1 minute', updated_at = now()
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

REVOKE EXECUTE ON FUNCTION public.start_freechat_session(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_freechat_session(UUID) TO service_role;

-- 세션 종료: p_started_at으로 "지금 끝내려는 세션이 실제로 그 세션이 맞는지"를
-- 확인해, 이미 다른 이유로 종료·갱신된 세션을 잘못 다시 cooldown 처리하지
-- 않는다(멱등). 일치하지 않으면 현재 저장된 상태를 그대로 반환한다.
CREATE OR REPLACE FUNCTION public.end_freechat_session(p_child_id UUID, p_started_at TIMESTAMPTZ)
RETURNS TABLE(status TEXT, cooldown_until TIMESTAMPTZ)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.freechat_usage_state;
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

  UPDATE public.freechat_usage_state
  SET status = 'cooldown', cooldown_until = now() + interval '1 minute', updated_at = now()
  WHERE freechat_usage_state.child_id = p_child_id
  RETURNING * INTO v_row;

  RETURN QUERY SELECT v_row.status, v_row.cooldown_until;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.end_freechat_session(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_freechat_session(UUID, TIMESTAMPTZ) TO service_role;
