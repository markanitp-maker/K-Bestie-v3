-- Mission v3 완료 기준(목표 10개 생성 / 5개 달성)에 맞춘 보상 함수 정합.
--
-- 이전 정의는 목표가 정확히 4개일 때만 지급하고 임계를 3으로 고정해, 목표 10개
-- 세션에서는 5개를 채워도 goals_not_initialized로 반환하며 황금열쇠도, COMPLETED
-- 전이도 일어나지 않았다(2026-08-14 Production 실측).
--
-- 2026-08-14 01:00에 동일 수정을 직접 적용했으나 이후 다른 세션이 기존 마이그레이션
-- (20260812234500_gold_key_active_balance_cap_50.sql)을 재적용하면서 옛 정의로
-- 되돌아갔다. 재발을 막기 위해 마이그레이션 체인에 남긴다.

CREATE OR REPLACE FUNCTION public.award_mission_v3_reward(p_child_id uuid, p_business_date date, p_reward_type text, p_source_session_id uuid)
 RETURNS TABLE(rewarded boolean, eligible boolean, reason text, applied_reward_type text, applied_business_date date, satisfied_goal_count integer)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_session public.chat_sessions;
  v_progress public.mission_progress;
  v_goal_count integer := 0;
  v_satisfied_goal_count integer := 0;
  v_active_balance integer := 0;
BEGIN
  IF p_child_id IS NULL OR p_business_date IS NULL OR p_source_session_id IS NULL THEN
    RAISE EXCEPTION 'child, business_date, and source session are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_reward_type <> 'mission_v3_complete' THEN
    RAISE EXCEPTION 'invalid Mission v3 reward_type: %', p_reward_type
      USING ERRCODE = '22023';
  END IF;

  -- Use the same child advisory lock as the existing mission/freechat Gold Key
  -- RPCs so cross-reward active-balance checks observe serialized ledger state.
  PERFORM pg_advisory_xact_lock(hashtext(p_child_id::text));

  SELECT * INTO v_session
  FROM public.chat_sessions
  WHERE id = p_source_session_id
  FOR UPDATE;

  IF v_session.id IS NULL
     OR v_session.child_id <> p_child_id
     OR v_session.session_type <> 'mission' THEN
    RAISE EXCEPTION 'source mission session does not belong to child'
      USING ERRCODE = '22023';
  END IF;
  IF v_session.business_date IS DISTINCT FROM p_business_date THEN
    RAISE EXCEPTION 'source session business_date mismatch'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_progress
  FROM public.mission_progress
  WHERE session_id = p_source_session_id
  FOR UPDATE;

  IF v_progress.session_id IS NULL
     OR v_progress.child_id <> p_child_id
     OR v_progress.business_date <> p_business_date::text
     OR v_progress.round_type <> 'daily_single'
     OR v_progress.mission_policy_version <> 'v3_single_daily' THEN
    RAISE EXCEPTION 'Mission v3 daily_single progress mismatch'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE status = 'SATISFIED')::integer
  INTO v_goal_count, v_satisfied_goal_count
  FROM public.conversation_goals
  WHERE mission_session_id = p_source_session_id
    AND child_id = p_child_id;

  -- An already-written key always wins over mutable session state on retries.
  IF EXISTS (
    SELECT 1
    FROM public.gold_key_ledger
    WHERE child_id = p_child_id
      AND business_date = p_business_date
      AND reward_type = p_reward_type
  ) THEN
    RETURN QUERY SELECT false, true, 'already_rewarded', p_reward_type,
      p_business_date, v_satisfied_goal_count;
    RETURN;
  END IF;

  IF v_goal_count = 0 THEN
    RETURN QUERY SELECT false, false, 'goals_not_initialized', p_reward_type,
      p_business_date, v_satisfied_goal_count;
    RETURN;
  END IF;

  IF v_satisfied_goal_count < LEAST(5, v_goal_count) THEN
    -- Boredom early finish with 0-2 goals never creates a completion reward
    -- row. Since there is no start reward, there is nothing to preserve.
    RETURN QUERY SELECT false, false, 'goal_threshold_not_met', p_reward_type,
      p_business_date, v_satisfied_goal_count;
    RETURN;
  END IF;

  -- Goal 3/4+ satisfied IS the v3 completion criterion (master §16.1/§17) —
  -- this RPC is the sole authority for it, since finalize_mission_turn_v1's
  -- legacy valid_answer_count path was deliberately excluded from
  -- v3_single_daily sessions. Transitioning status here (rather than
  -- requiring it as a precondition) also lets the existing
  -- trg_mission_progress_event_completion AFTER UPDATE trigger fire the
  -- master §17.4 "completion = event +1" requirement for free, reusing its
  -- established idempotent record_mission_event_completion call — no
  -- duplicate event-recording logic needed here.
  UPDATE public.mission_progress
  SET status = 'COMPLETED', updated_at = now()
  WHERE session_id = p_source_session_id
    AND status IS DISTINCT FROM 'COMPLETED';

  SELECT count(*)::integer INTO v_active_balance
  FROM public.gold_key_ledger
  WHERE child_id = p_child_id
    AND consumed = false
    AND expires_at > now();

  IF v_active_balance >= 50 THEN
    RETURN QUERY SELECT false, true, 'active_balance_limit', p_reward_type,
      p_business_date, v_satisfied_goal_count;
    RETURN;
  END IF;

  INSERT INTO public.gold_key_ledger (
    child_id,
    reason,
    expires_at,
    reward_type,
    source_session_id,
    business_date
  ) VALUES (
    p_child_id,
    'mission',
    now() + interval '7 days',
    p_reward_type,
    p_source_session_id,
    p_business_date
  )
  ON CONFLICT (child_id, business_date)
    WHERE reward_type IN ('mission_complete', 'mission_v3_complete')
  DO NOTHING;

  -- R4: plpgsql sets the RETURNING target to NULL (not false) when the
  -- ON CONFLICT ... DO NOTHING branch inserts 0 rows, so `IF NOT v_inserted`
  -- would be true for both "conflict" and "not yet checked" — check FOUND
  -- (the row-count flag from the statement itself) instead.
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, true, 'already_rewarded', p_reward_type,
      p_business_date, v_satisfied_goal_count;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, true, 'rewarded', p_reward_type,
    p_business_date, v_satisfied_goal_count;
END;
$function$

