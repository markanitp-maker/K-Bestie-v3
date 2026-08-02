-- 자유대화 쿨다운 오탐(HIGH) 수정 — end_freechat_session()이 cooldown_until을
-- "지금(now())"이 아니라 실제 세션 종료 시각(session_ends_at) 기준으로 앵커한다.
--
-- 근본 원인: 세션 종료는 app/chat/page.tsx의 클라이언트 setTimeout(hard-limit
-- 타이머) 1곳에서만 호출되는데(action:"end"), 브라우저가 백그라운드 탭/화면
-- 잠금 중 setTimeout을 스로틀링하면 이 타이머가 원래 예정 시각(세션 시작+10분)
-- 보다 한참(수십 분) 늦게 발화할 수 있다. 기존 코드는 그 "늦게 발화한 지금"을
-- 기준으로 cooldown_until = now() + 1분을 새로 잡아버려서, 아이가 앱을 다시
-- 열자마자(사실은 훨씬 전에 끝났어야 할 세션인데도) 갓 시작한 새 1분 휴식에
-- 걸린 것처럼 보였다(2026-08-02 대표님 Production 실사용 재현·확인).
--
-- 수정: cooldown_until을 항상 "실제 세션 종료 시각(session_ends_at) + 1분"으로
-- 고정한다. 타이머가 정시에 발화하면 지금까지와 동일하게 동작하고, 스로틀링으로
-- 늦게 발화해도 cooldown_until이 이미 과거이므로 클라이언트가 즉시 재진입
-- 가능하다고 판단한다(get_freechat_usage_state의 지연 전이(lazy transition)
-- 로직과 동일한 원칙).
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
  SET status = 'cooldown',
      cooldown_until = v_row.session_ends_at + interval '1 minute',
      updated_at = now()
  WHERE freechat_usage_state.child_id = p_child_id
  RETURNING * INTO v_row;

  RETURN QUERY SELECT v_row.status, v_row.cooldown_until;
END;
$$ LANGUAGE plpgsql;
