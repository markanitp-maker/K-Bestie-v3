-- 073 Mission v3 Phase 5A C2 regression fix: let a retry reuse the first
-- persisted GoalAssessment result and continue to shared finalization without
-- invoking the non-deterministic Goal assessor again.

-- PostgreSQL cannot change RETURNS TABLE OUT columns with CREATE OR REPLACE.
-- Drop only this exact Dev-only v3 signature, then recreate it below with the
-- stored answer_result added to the response contract.
DROP FUNCTION IF EXISTS public.start_mission_turn_v3(uuid,text,text,text,integer);

CREATE OR REPLACE FUNCTION public.start_mission_turn_v3(
  p_session_id uuid,
  p_client_turn_id text,
  p_answer_text text,
  p_voice_mode text,
  p_display_sequence integer
)
RETURNS TABLE (
  turn_status text,
  answer_result jsonb,
  already_processed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_message_id uuid;
  v_turn public.mission_turns%ROWTYPE;
  v_mission_policy_version text;
BEGIN
  IF p_client_turn_id IS NULL OR btrim(p_client_turn_id) = '' THEN
    RAISE EXCEPTION 'client_turn_id_required' USING ERRCODE = '22023';
  END IF;
  IF p_answer_text IS NULL OR length(p_answer_text) > 500 THEN
    RAISE EXCEPTION 'invalid_answer_text' USING ERRCODE = '22023';
  END IF;
  IF p_voice_mode NOT IN ('live', 'stt_tts') THEN
    RAISE EXCEPTION 'invalid_voice_mode' USING ERRCODE = '22023';
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

  IF FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.chat_messages cm
      WHERE cm.id = v_turn.child_message_id AND cm.content <> p_answer_text
    ) THEN
      RAISE EXCEPTION 'client_turn_payload_conflict' USING ERRCODE = '22023';
    END IF;
    UPDATE public.mission_turns
    SET attempt_count = attempt_count + 1,
        updated_at = CASE
          WHEN v_turn.k_message_id IS NULL
            AND v_turn.updated_at <= now() - interval '30 seconds'
            THEN now()
          ELSE updated_at
        END
    WHERE id = v_turn.id;

    -- A retry after assessment but before finalization receives the exact first
    -- result. The caller can skip Goal-assessor LLM work and proceed to finalize.
    RETURN QUERY SELECT v_turn.status, v_turn.answer_result,
      v_turn.k_message_id IS NOT NULL;
    RETURN;
  END IF;

  INSERT INTO public.chat_messages (
    session_id, turn_id, role, content, mode, voice_mode,
    display_sequence, turn_status, is_clarification
  ) VALUES (
    p_session_id, p_client_turn_id, 'child', p_answer_text, 'mission',
    p_voice_mode, p_display_sequence, 'finalized', false
  )
  ON CONFLICT (session_id, turn_id) DO NOTHING
  RETURNING id INTO v_message_id;

  IF v_message_id IS NULL THEN
    SELECT id INTO v_message_id
    FROM public.chat_messages
    WHERE session_id = p_session_id AND turn_id = p_client_turn_id AND role = 'child';
  END IF;
  IF v_message_id IS NULL THEN
    RAISE EXCEPTION 'client_turn_id_role_conflict' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.mission_turns (
    session_id, client_turn_id, question_id, child_message_id
  ) VALUES (
    -- Mission v3 has no fixed question identifier. This sentinel only satisfies
    -- the shared legacy mission_turns.question_id NOT NULL constraint.
    p_session_id, p_client_turn_id, 'v3_turn', v_message_id
  );

  RETURN QUERY SELECT 'CHILD_PERSISTED'::text, NULL::jsonb, false;
END;
$$;

COMMENT ON FUNCTION public.start_mission_turn_v3(uuid,text,text,text,integer) IS
  'Mission v3 only: persists one child turn and returns any first-writer GoalAssessment result so retries can skip reassessment and continue finalization.';

REVOKE ALL ON FUNCTION public.start_mission_turn_v3(uuid,text,text,text,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_mission_turn_v3(uuid,text,text,text,integer)
  TO service_role;

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
    -- First writer wins. A later non-deterministic LLM result is ignored so the
    -- original result remains finalizable instead of raising a conflict.
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
  'Mission v3 only: stores the first GoalAssessment array and transitions the turn for shared finalization. Retries preserve the first result and return already_assessed=true.';

REVOKE ALL ON FUNCTION public.mark_mission_turn_v3_assessed(uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_mission_turn_v3_assessed(uuid,text,jsonb)
  TO service_role;
