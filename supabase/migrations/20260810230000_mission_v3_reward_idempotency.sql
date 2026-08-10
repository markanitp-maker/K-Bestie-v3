-- 073 Mission v3 Phase 4: existing gold_key_ledger extension only.
-- Historical ledger rows are neither updated nor deleted. Mission v3 uses
-- dedicated reward types so legacy Mission I/II reward paths remain untouched.

BEGIN;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.gold_key_ledger'::regclass
      AND conname = 'gold_key_ledger_mission_v3_source_check'
  ) THEN
    ALTER TABLE public.gold_key_ledger
      ADD CONSTRAINT gold_key_ledger_mission_v3_source_check
      CHECK (
        reward_type NOT IN ('mission_v3_start', 'mission_v3_complete')
        OR (
          reason = 'mission'
          AND business_date IS NOT NULL
          AND source_session_id IS NOT NULL
        )
      ) NOT VALID;
  END IF;
END
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS gold_key_ledger_mission_v3_daily_reward_unique
  ON public.gold_key_ledger (child_id, business_date, reward_type)
  WHERE business_date IS NOT NULL
    AND reward_type IN ('mission_v3_start', 'mission_v3_complete');

COMMENT ON INDEX public.gold_key_ledger_mission_v3_daily_reward_unique IS
  'Mission v3 idempotency key: child_id + business_date + reward_type. Start/complete are each limited to one ledger row per KST business day.';

CREATE OR REPLACE FUNCTION public.award_mission_v3_reward(
  p_child_id uuid,
  p_business_date date,
  p_reward_type text,
  p_source_session_id uuid
)
RETURNS TABLE (
  rewarded boolean,
  eligible boolean,
  reason text,
  applied_reward_type text,
  applied_business_date date,
  satisfied_goal_count integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.chat_sessions;
  v_progress public.mission_progress;
  v_goal_count integer := 0;
  v_satisfied_goal_count integer := 0;
  v_active_balance integer := 0;
  v_inserted boolean := false;
BEGIN
  IF p_child_id IS NULL OR p_business_date IS NULL OR p_source_session_id IS NULL THEN
    RAISE EXCEPTION 'child, business_date, and source session are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_reward_type NOT IN ('mission_v3_start', 'mission_v3_complete') THEN
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

  IF v_goal_count <> 4 THEN
    RETURN QUERY SELECT false, false, 'goals_not_initialized', p_reward_type,
      p_business_date, v_satisfied_goal_count;
    RETURN;
  END IF;

  IF p_reward_type = 'mission_v3_start' AND v_progress.status = 'COMPLETED' THEN
    RETURN QUERY SELECT false, false, 'mission_already_completed', p_reward_type,
      p_business_date, v_satisfied_goal_count;
    RETURN;
  END IF;

  IF p_reward_type = 'mission_v3_complete' THEN
    IF v_progress.status IS DISTINCT FROM 'COMPLETED' THEN
      RETURN QUERY SELECT false, false, 'mission_not_completed', p_reward_type,
        p_business_date, v_satisfied_goal_count;
      RETURN;
    END IF;
    IF v_satisfied_goal_count < 3 THEN
      -- Boredom early finish with 0-2 goals never reverses the independent
      -- mission_v3_start row and never creates a completion reward row.
      RETURN QUERY SELECT false, false, 'goal_threshold_not_met', p_reward_type,
        p_business_date, v_satisfied_goal_count;
      RETURN;
    END IF;
  END IF;

  SELECT count(*)::integer INTO v_active_balance
  FROM public.gold_key_ledger
  WHERE child_id = p_child_id
    AND consumed = false
    AND expires_at > now();

  IF v_active_balance >= 22 THEN
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
  ON CONFLICT (child_id, business_date, reward_type)
    WHERE business_date IS NOT NULL
      AND reward_type IN ('mission_v3_start', 'mission_v3_complete')
  DO NOTHING
  RETURNING true INTO v_inserted;

  IF NOT v_inserted THEN
    RETURN QUERY SELECT false, true, 'already_rewarded', p_reward_type,
      p_business_date, v_satisfied_goal_count;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, true, 'rewarded', p_reward_type,
    p_business_date, v_satisfied_goal_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.award_mission_v3_reward(
  uuid, date, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_mission_v3_reward(
  uuid, date, text, uuid
) TO service_role;

COMMIT;
