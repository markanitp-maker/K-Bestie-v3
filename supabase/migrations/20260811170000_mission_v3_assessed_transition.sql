-- 073 Mission v3 Phase 5A gate fix: explicitly bridge a persisted v3 child
-- turn to the shared finalize_mission_turn_v1 contract. An empty JSON array is
-- a valid assessment result: Goal classification failure must not block the K
-- response from being persisted, but answer_result itself must never stay NULL.
CREATE OR REPLACE FUNCTION public.mark_mission_turn_v3_assessed(
  p_session_id uuid,
  p_client_turn_id text,
  p_goal_assessments jsonb
)
RETURNS TABLE (
  turn_status text,
  already_assessed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_turn public.mission_turns%ROWTYPE;
  v_mission_policy_version text;
BEGIN
  IF p_client_turn_id IS NULL OR btrim(p_client_turn_id) = '' THEN
    RAISE EXCEPTION 'client_turn_id_required' USING ERRCODE = '22023';
  END IF;
  IF p_goal_assessments IS NULL OR jsonb_typeof(p_goal_assessments) <> 'array' THEN
    RAISE EXCEPTION 'goal_assessments_array_required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_session_id::text || ':' || p_client_turn_id, 0));

  SELECT mp.mission_policy_version INTO v_mission_policy_version
  FROM public.mission_progress mp
  WHERE mp.session_id = p_session_id
  FOR SHARE;
  IF NOT FOUND OR v_mission_policy_version IS DISTINCT FROM 'v3_single_daily' THEN
    RAISE EXCEPTION 'not_v3_session' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_turn
  FROM public.mission_turns
  WHERE session_id = p_session_id AND client_turn_id = p_client_turn_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mission_turn_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_turn.question_id IS DISTINCT FROM 'v3_turn' THEN
    RAISE EXCEPTION 'not_v3_turn' USING ERRCODE = '22023';
  END IF;

  IF v_turn.answer_result IS NOT NULL THEN
    IF v_turn.answer_result IS DISTINCT FROM p_goal_assessments THEN
      RAISE EXCEPTION 'assessment_result_conflict' USING ERRCODE = '22023';
    END IF;

    -- Repair a legacy partial write defensively while preserving FINALIZED and
    -- other terminal states. Normal writes set both columns atomically below.
    IF v_turn.status = 'CHILD_PERSISTED' THEN
      UPDATE public.mission_turns
      SET status = 'ANSWER_PROCESSED', error_code = NULL, updated_at = now()
      WHERE id = v_turn.id;
      RETURN QUERY SELECT 'ANSWER_PROCESSED'::text, true;
    ELSE
      RETURN QUERY SELECT v_turn.status, true;
    END IF;
    RETURN;
  END IF;

  IF v_turn.status <> 'CHILD_PERSISTED' THEN
    RAISE EXCEPTION 'invalid_v3_assessment_transition' USING ERRCODE = '22023';
  END IF;

  UPDATE public.mission_turns
  SET answer_result = p_goal_assessments,
      status = 'ANSWER_PROCESSED',
      error_code = NULL,
      updated_at = now()
  WHERE id = v_turn.id;

  RETURN QUERY SELECT 'ANSWER_PROCESSED'::text, false;
END;
$$;

COMMENT ON FUNCTION public.mark_mission_turn_v3_assessed(uuid,text,jsonb) IS
  'Mission v3 only: stores the GoalAssessment JSON array (including an empty array) and transitions CHILD_PERSISTED to ANSWER_PROCESSED so finalize_mission_turn_v1 can persist the K response. Same-payload retries are idempotent; conflicting retries fail.';

REVOKE ALL ON FUNCTION public.mark_mission_turn_v3_assessed(uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_mission_turn_v3_assessed(uuid,text,jsonb)
  TO service_role;
