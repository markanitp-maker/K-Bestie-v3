-- 089 gate-1 follow-up: the test-account variants rendered from the live
-- /child/missions page call /api/mission/answer or /api/mission/answer-lean
-- directly. Both routes complete V2 sessions through record_v2_mission_answer,
-- so that legacy writer must share the same child/business-date constraint as
-- finalize_mission_turn_v1. Historical ledger rows remain untouched.

CREATE OR REPLACE FUNCTION public.record_v2_mission_answer(
  p_session_id uuid,
  p_child_id uuid,
  p_question_id uuid,
  p_answer_status text,
  p_answer_classification text,
  p_required_valid_count integer,
  p_reward_type text
)
RETURNS TABLE (
  blocked boolean,
  valid_answer_count integer,
  completed boolean,
  newly_completed boolean,
  reward_status text,
  status text,
  question_states jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_progress_status text;
  v_mission_policy_version text;
  v_prev_question_states jsonb;
  v_prev_valid_count integer;
  v_prev_state text;
  v_new_state text;
  v_progress_awarded_new boolean;
  v_valid_count integer;
  v_completed boolean;
  v_newly_completed boolean;
  v_reward_status text := 'not_applicable';
  v_updated_states jsonb;
  v_business_date date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_active_balance integer := 0;
BEGIN
  SELECT
    mp.status,
    mp.mission_policy_version,
    mp.question_states,
    mp.valid_answer_count
  INTO
    v_progress_status,
    v_mission_policy_version,
    v_prev_question_states,
    v_prev_valid_count
  FROM public.mission_progress mp
  WHERE mp.session_id = p_session_id
  FOR UPDATE;

  IF NOT FOUND OR v_progress_status IN ('SAFETY_PAUSED', 'COMPLETED', 'FORCE_ENDED') THEN
    RETURN QUERY SELECT
      true,
      COALESCE(v_prev_valid_count, 0),
      v_progress_status = 'COMPLETED',
      false,
      'not_applicable'::text,
      COALESCE(v_progress_status, 'NOT_FOUND'),
      COALESCE(v_prev_question_states, '{}'::jsonb);
    RETURN;
  END IF;

  -- Mission v3 owns completion and reward through award_mission_v3_reward.
  -- Never let the legacy V2 route become a second v3 completion writer.
  IF v_mission_policy_version = 'v3_single_daily' THEN
    RETURN QUERY SELECT
      true,
      COALESCE(v_prev_valid_count, 0),
      false,
      false,
      'not_applicable'::text,
      v_progress_status,
      COALESCE(v_prev_question_states, '{}'::jsonb);
    RETURN;
  END IF;

  v_prev_question_states := COALESCE(v_prev_question_states, '{}'::jsonb);
  v_prev_state := COALESCE(v_prev_question_states->>p_question_id::text, 'pending');
  v_new_state := p_answer_status;

  IF v_prev_state = 'answered' AND v_new_state <> 'answered' THEN
    UPDATE public.mission_question_history
    SET progress_awarded = false
    WHERE session_id = p_session_id
      AND question_id = p_question_id
      AND progress_awarded = true;
  END IF;

  v_progress_awarded_new := v_prev_state <> 'answered' AND v_new_state = 'answered';

  INSERT INTO public.mission_question_history (
    child_id,
    question_id,
    answer_status,
    answer_classification,
    progress_awarded,
    session_id
  ) VALUES (
    p_child_id,
    p_question_id,
    p_answer_status,
    p_answer_classification,
    v_progress_awarded_new,
    p_session_id
  );

  SELECT count(*)::integer INTO v_valid_count
  FROM public.mission_question_history
  WHERE session_id = p_session_id
    AND answer_classification = 'VALID'
    AND progress_awarded = true;

  v_completed := v_valid_count >= p_required_valid_count;
  v_newly_completed := v_completed AND v_progress_status <> 'COMPLETED';
  v_updated_states := v_prev_question_states
    || jsonb_build_object(p_question_id::text, v_new_state);

  UPDATE public.mission_progress mp
  SET question_states = v_updated_states,
      valid_answer_count = v_valid_count,
      updated_at = now(),
      status = CASE WHEN v_newly_completed THEN 'COMPLETED' ELSE mp.status END
  WHERE mp.session_id = p_session_id
  RETURNING mp.status INTO v_progress_status;

  IF v_newly_completed THEN
    UPDATE public.mission_question_history
    SET termination_reason = 'COMPLETED'
    WHERE session_id = p_session_id
      AND asked_order IS NULL;

    -- Preserve the existing child-scoped wallet serialization and 22-key cap.
    PERFORM pg_advisory_xact_lock(hashtext(p_child_id::text));

    IF EXISTS (
      SELECT 1
      FROM public.gold_key_ledger
      WHERE child_id = p_child_id
        AND mission_id = p_session_id
        AND reward_type = p_reward_type
    ) THEN
      v_reward_status := 'already_earned';
    ELSE
      SELECT count(*)::integer INTO v_active_balance
      FROM public.gold_key_ledger
      WHERE child_id = p_child_id
        AND consumed = false
        AND expires_at > now();

      IF v_active_balance >= 22 THEN
        v_reward_status := 'max_balance_reached';
      ELSE
        INSERT INTO public.gold_key_ledger (
          child_id,
          reason,
          mission_id,
          reward_type,
          expires_at,
          business_date
        ) VALUES (
          p_child_id,
          'mission',
          p_session_id,
          p_reward_type,
          now() + interval '7 days',
          v_business_date
        )
        ON CONFLICT (child_id, business_date)
          WHERE reward_type = 'mission_complete'
        DO NOTHING;

        IF FOUND THEN
          v_reward_status := 'awarded';
        ELSE
          v_reward_status := 'daily_limit_reached';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT
    false,
    v_valid_count,
    v_completed,
    v_newly_completed,
    v_reward_status,
    v_progress_status,
    v_updated_states;
END;
$$;

REVOKE ALL ON FUNCTION public.record_v2_mission_answer(
  uuid, uuid, uuid, text, text, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_v2_mission_answer(
  uuid, uuid, uuid, text, text, integer, text
) TO service_role;
