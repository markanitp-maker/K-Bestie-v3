-- 073 Mission v3 Phase 5C gate fixes: session-serialized turn admission,
-- first-writer K draft/prompt provenance, and atomic safety/boredom finalization.

ALTER TABLE public.mission_turns
  ADD COLUMN IF NOT EXISTS k_response_draft text,
  ADD COLUMN IF NOT EXISTS previous_prompted_goal_id uuid
    REFERENCES public.conversation_goals(goal_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prompted_goal_id uuid
    REFERENCES public.conversation_goals(goal_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS engine_category text,
  ADD COLUMN IF NOT EXISTS safety_subcategory text,
  ADD COLUMN IF NOT EXISTS boredom_early_finish boolean NOT NULL DEFAULT false;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mission_turns'::regclass
      AND conname = 'mission_turns_engine_category_check'
  ) THEN
    ALTER TABLE public.mission_turns
      ADD CONSTRAINT mission_turns_engine_category_check
      CHECK (engine_category IS NULL OR engine_category IN ('safety', 'deterministic', 'generated'));
  END IF;
END
$migration$;

COMMENT ON COLUMN public.mission_turns.k_response_draft IS
  'First generated K response for this logical v3 turn. First writer wins so retries never regenerate after this boundary.';
COMMENT ON COLUMN public.mission_turns.previous_prompted_goal_id IS
  'Goal prompted by the preceding finalized v3 turn, snapshotted when this turn is admitted.';
COMMENT ON COLUMN public.mission_turns.prompted_goal_id IS
  'Goal K selected to prompt during this v3 turn; consumed as previous_prompted_goal_id by the next turn.';
COMMENT ON COLUMN public.mission_turns.boredom_early_finish IS
  'Common conversation engine allowed an early finish for this turn; finalization applies it only below the 3-goal threshold.';

DROP FUNCTION IF EXISTS public.start_mission_turn_v3(uuid,text,text,text,integer);

CREATE FUNCTION public.start_mission_turn_v3(
  p_session_id uuid,
  p_client_turn_id text,
  p_answer_text text,
  p_voice_mode text,
  p_display_sequence integer
)
RETURNS TABLE (
  turn_status text,
  answer_result jsonb,
  k_response_draft text,
  previous_prompted_goal_id uuid,
  prompted_goal_id uuid,
  engine_category text,
  safety_subcategory text,
  boredom_early_finish boolean,
  already_processed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_message_id uuid;
  v_turn public.mission_turns%ROWTYPE;
  v_progress public.mission_progress%ROWTYPE;
  v_previous_prompted_goal_id uuid;
  v_recent_processing boolean := false;
  v_satisfied_goal_count integer := 0;
BEGIN
  IF p_client_turn_id IS NULL OR btrim(p_client_turn_id) = '' THEN
    RAISE EXCEPTION 'client_turn_id_required' USING ERRCODE = '22023';
  END IF;
  IF p_answer_text IS NULL OR btrim(p_answer_text) = '' OR length(p_answer_text) > 500 THEN
    RAISE EXCEPTION 'invalid_answer_text' USING ERRCODE = '22023';
  END IF;
  IF p_voice_mode NOT IN ('live', 'stt_tts') THEN
    RAISE EXCEPTION 'invalid_voice_mode' USING ERRCODE = '22023';
  END IF;
  IF p_display_sequence IS NULL OR p_display_sequence < 0 THEN
    RAISE EXCEPTION 'invalid_display_sequence' USING ERRCODE = '22023';
  END IF;

  -- One v3 logical turn may be admitted per session. The row lock and status
  -- validation happen under the same transaction as child-message insertion.
  PERFORM pg_advisory_xact_lock(hashtextextended('mission-v3-session:' || p_session_id::text, 0));

  SELECT * INTO v_progress
  FROM public.mission_progress
  WHERE session_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_progress.mission_policy_version IS DISTINCT FROM 'v3_single_daily'
     OR v_progress.round_type IS DISTINCT FROM 'daily_single' THEN
    RAISE EXCEPTION 'not_v3_session' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_turn
  FROM public.mission_turns
  WHERE session_id = p_session_id AND client_turn_id = p_client_turn_id
  FOR UPDATE;

  IF FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.chat_messages cm
      WHERE cm.id = v_turn.child_message_id
        AND (cm.content IS DISTINCT FROM p_answer_text
          OR cm.voice_mode IS DISTINCT FROM p_voice_mode
          OR cm.display_sequence IS DISTINCT FROM p_display_sequence)
    ) THEN
      RAISE EXCEPTION 'client_turn_payload_conflict' USING ERRCODE = '22023';
    END IF;
    IF v_turn.status <> 'FINALIZED' AND v_progress.status IS DISTINCT FROM 'IN_PROGRESS' THEN
      RAISE EXCEPTION 'mission_not_in_progress:%', COALESCE(v_progress.status, 'NULL')
        USING ERRCODE = '55000';
    END IF;

    v_recent_processing := v_turn.status <> 'FINALIZED'
      AND v_turn.k_response_draft IS NULL
      AND v_turn.updated_at > now() - interval '30 seconds';

    UPDATE public.mission_turns
    SET attempt_count = attempt_count + 1,
        updated_at = CASE WHEN v_recent_processing THEN updated_at ELSE now() END
    WHERE id = v_turn.id;

    RETURN QUERY SELECT
      v_turn.status,
      v_turn.answer_result,
      v_turn.k_response_draft,
      v_turn.previous_prompted_goal_id,
      v_turn.prompted_goal_id,
      v_turn.engine_category,
      v_turn.safety_subcategory,
      v_turn.boredom_early_finish,
      (v_recent_processing OR v_turn.k_response_draft IS NOT NULL OR v_turn.status = 'FINALIZED');
    RETURN;
  END IF;

  IF v_progress.status IS DISTINCT FROM 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'mission_not_in_progress:%', COALESCE(v_progress.status, 'NULL')
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*)::integer INTO v_satisfied_goal_count
  FROM public.conversation_goals
  WHERE mission_session_id = p_session_id AND status = 'SATISFIED';
  IF v_satisfied_goal_count >= 3 THEN
    RAISE EXCEPTION 'mission_completion_pending' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.mission_turns mt
    WHERE mt.session_id = p_session_id
      AND mt.question_id = 'v3_turn'
      AND mt.status <> 'FINALIZED'
  ) THEN
    RAISE EXCEPTION 'another_mission_turn_in_progress' USING ERRCODE = '55000';
  END IF;

  SELECT mt.prompted_goal_id INTO v_previous_prompted_goal_id
  FROM public.mission_turns mt
  JOIN public.chat_messages cm ON cm.id = mt.child_message_id
  WHERE mt.session_id = p_session_id
    AND mt.question_id = 'v3_turn'
    AND mt.status = 'FINALIZED'
  ORDER BY cm.display_sequence DESC NULLS LAST, mt.created_at DESC
  LIMIT 1;

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
    session_id, client_turn_id, question_id, child_message_id,
    previous_prompted_goal_id
  ) VALUES (
    p_session_id, p_client_turn_id, 'v3_turn', v_message_id,
    v_previous_prompted_goal_id
  );

  RETURN QUERY SELECT
    'CHILD_PERSISTED'::text,
    NULL::jsonb,
    NULL::text,
    v_previous_prompted_goal_id,
    NULL::uuid,
    NULL::text,
    NULL::text,
    false,
    false;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_mission_turn_v3_assessed(
  p_session_id uuid,
  p_client_turn_id text,
  p_goal_assessments jsonb
)
RETURNS TABLE (turn_status text, already_assessed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_turn public.mission_turns%ROWTYPE;
  v_progress public.mission_progress%ROWTYPE;
BEGIN
  IF p_client_turn_id IS NULL OR btrim(p_client_turn_id) = '' THEN
    RAISE EXCEPTION 'client_turn_id_required' USING ERRCODE = '22023';
  END IF;
  IF p_goal_assessments IS NULL OR jsonb_typeof(p_goal_assessments) <> 'array' THEN
    RAISE EXCEPTION 'goal_assessments_array_required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('mission-v3-session:' || p_session_id::text, 0));

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
    RETURN QUERY SELECT v_turn.status, true;
    RETURN;
  END IF;

  SELECT * INTO v_progress
  FROM public.mission_progress
  WHERE session_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_progress.mission_policy_version IS DISTINCT FROM 'v3_single_daily'
     OR v_progress.status IS DISTINCT FROM 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'mission_not_in_progress' USING ERRCODE = '55000';
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

CREATE OR REPLACE FUNCTION public.store_mission_turn_v3_output(
  p_session_id uuid,
  p_client_turn_id text,
  p_k_response_draft text,
  p_prompted_goal_id uuid,
  p_engine_category text,
  p_safety_subcategory text,
  p_boredom_early_finish boolean
)
RETURNS TABLE (
  k_response_draft text,
  prompted_goal_id uuid,
  engine_category text,
  safety_subcategory text,
  boredom_early_finish boolean,
  already_stored boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_turn public.mission_turns%ROWTYPE;
  v_progress public.mission_progress%ROWTYPE;
BEGIN
  IF p_k_response_draft IS NULL OR btrim(p_k_response_draft) = '' THEN
    RAISE EXCEPTION 'k_response_draft_required' USING ERRCODE = '22023';
  END IF;
  IF p_engine_category IS NULL OR p_engine_category NOT IN ('safety', 'deterministic', 'generated') THEN
    RAISE EXCEPTION 'invalid_engine_category' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('mission-v3-session:' || p_session_id::text, 0));

  SELECT * INTO v_turn
  FROM public.mission_turns
  WHERE session_id = p_session_id AND client_turn_id = p_client_turn_id
  FOR UPDATE;
  IF NOT FOUND OR v_turn.question_id IS DISTINCT FROM 'v3_turn' THEN
    RAISE EXCEPTION 'mission_v3_turn_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_turn.k_response_draft IS NOT NULL THEN
    RETURN QUERY SELECT
      v_turn.k_response_draft,
      v_turn.prompted_goal_id,
      v_turn.engine_category,
      v_turn.safety_subcategory,
      v_turn.boredom_early_finish,
      true;
    RETURN;
  END IF;

  SELECT * INTO v_progress
  FROM public.mission_progress
  WHERE session_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_progress.mission_policy_version IS DISTINCT FROM 'v3_single_daily'
     OR v_progress.status IS DISTINCT FROM 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'mission_not_in_progress' USING ERRCODE = '55000';
  END IF;

  IF v_turn.answer_result IS NULL OR v_turn.status <> 'ANSWER_PROCESSED' THEN
    RAISE EXCEPTION 'mission_turn_not_assessed' USING ERRCODE = '55000';
  END IF;

  IF p_prompted_goal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.conversation_goals cg
    WHERE cg.goal_id = p_prompted_goal_id
      AND cg.mission_session_id = p_session_id
  ) THEN
    RAISE EXCEPTION 'prompted_goal_session_mismatch' USING ERRCODE = '22023';
  END IF;

  UPDATE public.mission_turns
  SET k_response_draft = btrim(p_k_response_draft),
      prompted_goal_id = p_prompted_goal_id,
      engine_category = p_engine_category,
      safety_subcategory = p_safety_subcategory,
      boredom_early_finish = COALESCE(p_boredom_early_finish, false),
      error_code = NULL,
      updated_at = now()
  WHERE id = v_turn.id
  RETURNING * INTO v_turn;

  RETURN QUERY SELECT
    v_turn.k_response_draft,
    v_turn.prompted_goal_id,
    v_turn.engine_category,
    v_turn.safety_subcategory,
    v_turn.boredom_early_finish,
    false;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_mission_turn_v3(
  p_session_id uuid,
  p_client_turn_id text,
  p_k_display_sequence integer
)
RETURNS TABLE (
  progress_status text,
  k_response text,
  prompted_goal_id uuid,
  safety_paused boolean,
  early_ended boolean,
  already_finalized boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_turn public.mission_turns%ROWTYPE;
  v_progress public.mission_progress%ROWTYPE;
  v_k_message_id uuid;
  v_k_response text;
  v_child_text text;
  v_voice_mode text;
  v_satisfied_goal_count integer := 0;
  v_safety_paused boolean := false;
  v_early_ended boolean := false;
BEGIN
  IF p_k_display_sequence IS NULL OR p_k_display_sequence < 0 THEN
    RAISE EXCEPTION 'invalid_k_display_sequence' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('mission-v3-session:' || p_session_id::text, 0));

  SELECT * INTO v_progress
  FROM public.mission_progress
  WHERE session_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_progress.mission_policy_version IS DISTINCT FROM 'v3_single_daily'
     OR v_progress.round_type IS DISTINCT FROM 'daily_single' THEN
    RAISE EXCEPTION 'not_v3_session' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_turn
  FROM public.mission_turns
  WHERE session_id = p_session_id AND client_turn_id = p_client_turn_id
  FOR UPDATE;
  IF NOT FOUND OR v_turn.question_id IS DISTINCT FROM 'v3_turn' THEN
    RAISE EXCEPTION 'mission_v3_turn_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_turn.status = 'FINALIZED' THEN
    SELECT cm.content INTO v_k_response
    FROM public.chat_messages cm
    WHERE cm.id = v_turn.k_message_id AND cm.role = 'k';
    RETURN QUERY SELECT
      v_progress.status,
      COALESCE(v_k_response, v_turn.k_response_draft),
      v_turn.prompted_goal_id,
      v_progress.status = 'SAFETY_PAUSED',
      v_progress.status = 'FORCE_ENDED' AND v_turn.boredom_early_finish,
      true;
    RETURN;
  END IF;

  IF v_turn.status <> 'ANSWER_PROCESSED'
     OR v_turn.answer_result IS NULL
     OR v_turn.k_response_draft IS NULL
     OR v_turn.engine_category IS NULL THEN
    RAISE EXCEPTION 'mission_v3_output_not_stored' USING ERRCODE = '55000';
  END IF;
  IF v_progress.status IS DISTINCT FROM 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'mission_not_in_progress:%', COALESCE(v_progress.status, 'NULL')
      USING ERRCODE = '55000';
  END IF;

  SELECT cm.content, cm.voice_mode
  INTO v_child_text, v_voice_mode
  FROM public.chat_messages cm
  WHERE cm.id = v_turn.child_message_id AND cm.role = 'child';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mission_child_message_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.chat_messages (
    session_id, turn_id, role, content, mode, voice_mode,
    display_sequence, turn_status, is_clarification
  ) VALUES (
    p_session_id, p_client_turn_id || ':k', 'k', v_turn.k_response_draft,
    'mission', COALESCE(v_voice_mode, 'stt_tts'), p_k_display_sequence,
    'finalized', false
  )
  ON CONFLICT (session_id, turn_id) DO NOTHING
  RETURNING id INTO v_k_message_id;

  IF v_k_message_id IS NULL THEN
    SELECT id INTO v_k_message_id
    FROM public.chat_messages
    WHERE session_id = p_session_id
      AND turn_id = p_client_turn_id || ':k'
      AND role = 'k';
  END IF;
  IF v_k_message_id IS NULL THEN
    RAISE EXCEPTION 'k_turn_id_role_conflict' USING ERRCODE = '23505';
  END IF;

  IF v_turn.engine_category = 'safety' THEN
    UPDATE public.mission_progress
    SET status = 'SAFETY_PAUSED', updated_at = now()
    WHERE session_id = p_session_id;
    v_progress.status := 'SAFETY_PAUSED';
    v_safety_paused := true;

    INSERT INTO public.safety_events (
      session_id, subcategory, child_text, source, child_id,
      event_stage, policy_version
    ) VALUES (
      p_session_id,
      COALESCE(NULLIF(v_turn.safety_subcategory, ''), 'violence'),
      v_child_text,
      'QUESTION_ENGINE',
      v_progress.child_id,
      'mission_turn',
      'v3_single_daily'
    );
  ELSIF v_turn.boredom_early_finish THEN
    SELECT count(*)::integer INTO v_satisfied_goal_count
    FROM public.conversation_goals
    WHERE mission_session_id = p_session_id AND status = 'SATISFIED';

    IF v_satisfied_goal_count <= 2 THEN
      UPDATE public.mission_progress
      SET status = 'FORCE_ENDED', updated_at = now()
      WHERE session_id = p_session_id;
      UPDATE public.chat_sessions
      SET ended_at = COALESCE(ended_at, now()),
          ended_reason = COALESCE(ended_reason, 'BOREDOM_EARLY_FINISH')
      WHERE id = p_session_id;
      v_progress.status := 'FORCE_ENDED';
      v_early_ended := true;
    END IF;
  END IF;

  UPDATE public.mission_turns
  SET k_message_id = v_k_message_id,
      status = 'FINALIZED',
      finalized_at = now(),
      updated_at = now(),
      error_code = NULL
  WHERE id = v_turn.id;

  RETURN QUERY SELECT
    v_progress.status,
    v_turn.k_response_draft,
    v_turn.prompted_goal_id,
    v_safety_paused,
    v_early_ended,
    false;
END;
$$;

REVOKE ALL ON FUNCTION public.start_mission_turn_v3(uuid,text,text,text,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_mission_turn_v3_assessed(uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_mission_turn_v3_output(uuid,text,text,uuid,text,text,boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_mission_turn_v3(uuid,text,integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.start_mission_turn_v3(uuid,text,text,text,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_mission_turn_v3_assessed(uuid,text,jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.store_mission_turn_v3_output(uuid,text,text,uuid,text,text,boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_mission_turn_v3(uuid,text,integer)
  TO service_role;
