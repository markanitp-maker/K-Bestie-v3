-- Request 069: mission logical-turn ledger and atomic persistence primitives.
-- External LLM calls remain outside transactions. The start/finalize RPCs make
-- each database boundary idempotent and serialize retries by logical turn.

CREATE TABLE IF NOT EXISTS public.mission_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  client_turn_id text NOT NULL,
  question_id text NOT NULL,
  status text NOT NULL DEFAULT 'CHILD_PERSISTED'
    CHECK (status IN ('CHILD_PERSISTED', 'ANSWER_PROCESSED', 'FINALIZED', 'FAILED')),
  child_message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  k_message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  answer_result jsonb,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  UNIQUE (session_id, client_turn_id)
);

CREATE INDEX IF NOT EXISTS idx_mission_turns_recovery
  ON public.mission_turns (session_id, status, updated_at DESC);

ALTER TABLE public.mission_turns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mission_turns_service_only ON public.mission_turns;
CREATE POLICY mission_turns_service_only
  ON public.mission_turns FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON public.mission_turns TO service_role;
REVOKE ALL ON public.mission_turns FROM anon, authenticated;

-- V2 answer recording for the Turn API. It deliberately stops before mission
-- completion/reward; finalize_mission_turn_v1 performs those operations only
-- after the K message exists. The legacy RPC remains unchanged for callers
-- outside the new Turn API during the rollout.
CREATE OR REPLACE FUNCTION public.record_v2_mission_answer_pending(
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
  v_prev_question_states jsonb;
  v_prev_state text;
  v_new_state text;
  v_progress_awarded_new boolean;
  v_valid_count integer;
  v_updated_states jsonb;
BEGIN
  SELECT mp.status, mp.question_states
  INTO v_progress_status, v_prev_question_states
  FROM public.mission_progress mp
  WHERE mp.session_id = p_session_id
  FOR UPDATE;

  IF NOT FOUND OR v_progress_status IN ('SAFETY_PAUSED', 'COMPLETED', 'FORCE_ENDED') THEN
    RETURN QUERY SELECT true, 0, v_progress_status = 'COMPLETED', false,
      'not_applicable'::text, COALESCE(v_progress_status, 'NOT_FOUND'),
      COALESCE(v_prev_question_states, '{}'::jsonb);
    RETURN;
  END IF;

  v_prev_question_states := COALESCE(v_prev_question_states, '{}'::jsonb);
  v_prev_state := COALESCE(v_prev_question_states->>p_question_id::text, 'pending');
  v_new_state := p_answer_status;

  IF v_prev_state = 'answered' AND v_new_state <> 'answered' THEN
    UPDATE public.mission_question_history
    SET progress_awarded = false
    WHERE session_id = p_session_id AND question_id = p_question_id
      AND progress_awarded = true;
  END IF;

  v_progress_awarded_new := v_prev_state <> 'answered' AND v_new_state = 'answered';
  INSERT INTO public.mission_question_history (
    child_id, question_id, answer_status, answer_classification,
    progress_awarded, session_id
  ) VALUES (
    p_child_id, p_question_id, p_answer_status, p_answer_classification,
    v_progress_awarded_new, p_session_id
  );

  SELECT count(*)::integer INTO v_valid_count
  FROM public.mission_question_history
  WHERE session_id = p_session_id
    AND answer_classification = 'VALID' AND progress_awarded = true;

  v_updated_states := v_prev_question_states || jsonb_build_object(p_question_id::text, v_new_state);
  UPDATE public.mission_progress
  SET question_states = v_updated_states,
      valid_answer_count = v_valid_count,
      updated_at = now()
  WHERE session_id = p_session_id;

  RETURN QUERY SELECT false, v_valid_count,
    v_valid_count >= p_required_valid_count, false,
    'pending_finalization'::text, v_progress_status, v_updated_states;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_mission_turn_v1(
  p_session_id uuid,
  p_client_turn_id text,
  p_question_id text,
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
BEGIN
  IF p_client_turn_id IS NULL OR btrim(p_client_turn_id) = '' THEN
    RAISE EXCEPTION 'client_turn_id_required' USING ERRCODE = '22023';
  END IF;
  IF p_answer_text IS NULL OR length(p_answer_text) > 500 THEN
    RAISE EXCEPTION 'invalid_answer_text' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_session_id::text || ':' || p_client_turn_id, 0));

  SELECT * INTO v_turn
  FROM public.mission_turns
  WHERE session_id = p_session_id AND client_turn_id = p_client_turn_id
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.mission_turns
    SET attempt_count = attempt_count + 1,
        updated_at = CASE
          WHEN v_turn.answer_result IS NULL AND v_turn.updated_at <= now() - interval '30 seconds'
            THEN now()
          ELSE updated_at
        END
    WHERE id = v_turn.id;
    -- A turn with a stored result is a replay. A recent CHILD_PERSISTED row is
    -- owned by another in-flight request. After a bounded lease expires, a
    -- retry may resume answer processing with the same logical turn.
    RETURN QUERY SELECT v_turn.status, v_turn.answer_result,
      (v_turn.answer_result IS NOT NULL OR v_turn.updated_at > now() - interval '30 seconds');
    RETURN;
  END IF;

  INSERT INTO public.chat_messages (
    session_id, turn_id, role, content, mode, voice_mode,
    display_sequence, turn_status, is_clarification
  ) VALUES (
    p_session_id, p_client_turn_id, 'child', p_answer_text, 'mission',
    COALESCE(NULLIF(p_voice_mode, ''), 'manual'), p_display_sequence,
    'finalized', false
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
    p_session_id, p_client_turn_id, p_question_id, v_message_id
  );

  RETURN QUERY SELECT 'CHILD_PERSISTED'::text, NULL::jsonb, false;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_mission_turn_answered_v1(
  p_session_id uuid,
  p_client_turn_id text,
  p_answer_result jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_session_id::text || ':' || p_client_turn_id, 0));
  UPDATE public.mission_turns
  SET answer_result = COALESCE(answer_result, p_answer_result),
      status = CASE WHEN status = 'CHILD_PERSISTED' THEN 'ANSWER_PROCESSED' ELSE status END,
      error_code = NULL,
      updated_at = now()
  WHERE session_id = p_session_id AND client_turn_id = p_client_turn_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mission_turn_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_mission_turn_v1(
  p_session_id uuid,
  p_client_turn_id text,
  p_k_content text,
  p_k_turn_id text,
  p_k_display_sequence integer,
  p_is_clarification boolean DEFAULT false
)
RETURNS TABLE (
  completed boolean,
  reward_status text,
  already_finalized boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_turn public.mission_turns%ROWTYPE;
  v_progress public.mission_progress%ROWTYPE;
  v_session public.chat_sessions%ROWTYPE;
  v_k_message_id uuid;
  v_completed boolean := false;
  v_reward_status text := 'none';
  v_active_balance integer := 0;
  v_earned_today integer := 0;
BEGIN
  IF p_k_content IS NULL OR btrim(p_k_content) = '' THEN
    RAISE EXCEPTION 'k_content_required' USING ERRCODE = '22023';
  END IF;
  IF p_k_turn_id <> p_client_turn_id || ':k' THEN
    RAISE EXCEPTION 'invalid_k_turn_id' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_session_id::text || ':' || p_client_turn_id, 0));

  SELECT * INTO v_turn FROM public.mission_turns
  WHERE session_id = p_session_id AND client_turn_id = p_client_turn_id
  FOR UPDATE;
  IF NOT FOUND OR v_turn.answer_result IS NULL THEN
    RAISE EXCEPTION 'mission_turn_not_answered' USING ERRCODE = 'P0002';
  END IF;

  IF v_turn.status = 'FINALIZED' THEN
    SELECT status = 'COMPLETED' INTO v_completed
    FROM public.mission_progress WHERE session_id = p_session_id;
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM public.gold_key_ledger
      WHERE mission_id = p_session_id AND reward_type = 'mission_complete'
    ) THEN 'already_earned' ELSE 'none' END INTO v_reward_status;
    RETURN QUERY SELECT v_completed, v_reward_status, true;
    RETURN;
  END IF;

  INSERT INTO public.chat_messages (
    session_id, turn_id, role, content, mode, voice_mode,
    display_sequence, turn_status, is_clarification
  ) VALUES (
    p_session_id, p_k_turn_id, 'k', p_k_content, 'mission',
    COALESCE((SELECT voice_mode FROM public.chat_messages WHERE id = v_turn.child_message_id), 'stt_tts'),
    p_k_display_sequence, 'finalized', COALESCE(p_is_clarification, false)
  )
  ON CONFLICT (session_id, turn_id) DO NOTHING
  RETURNING id INTO v_k_message_id;

  IF v_k_message_id IS NULL THEN
    SELECT id INTO v_k_message_id FROM public.chat_messages
    WHERE session_id = p_session_id AND turn_id = p_k_turn_id AND role = 'k';
  END IF;
  IF v_k_message_id IS NULL THEN
    RAISE EXCEPTION 'k_turn_id_role_conflict' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_progress FROM public.mission_progress
  WHERE session_id = p_session_id FOR UPDATE;
  SELECT * INTO v_session FROM public.chat_sessions
  WHERE id = p_session_id;

  v_completed := COALESCE(v_progress.valid_answer_count, 0) >= COALESCE(v_progress.required_valid_count, 5);

  IF v_completed THEN
    SELECT count(*)::integer INTO v_active_balance
    FROM public.gold_key_ledger
    WHERE child_id = v_session.child_id AND consumed = false AND expires_at > now();

    SELECT count(*)::integer INTO v_earned_today
    FROM public.gold_key_ledger
    WHERE child_id = v_session.child_id
      AND reason = 'mission'
      AND earned_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'
      AND earned_at < (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') + interval '1 day') AT TIME ZONE 'Asia/Seoul';

    IF EXISTS (
      SELECT 1 FROM public.gold_key_ledger
      WHERE child_id = v_session.child_id AND mission_id = p_session_id
        AND reward_type = 'mission_complete'
    ) THEN
      v_reward_status := 'already_earned';
    ELSIF v_earned_today >= 2 THEN
      v_reward_status := 'daily_limit_reached';
    ELSIF v_active_balance >= 22 THEN
      v_reward_status := 'balance_limit_reached';
    ELSE
      INSERT INTO public.gold_key_ledger (
        child_id, reason, expires_at, mission_id, reward_type
      ) VALUES (
        v_session.child_id, 'mission', now() + interval '7 days',
        p_session_id, 'mission_complete'
      );
      v_reward_status := 'awarded';
    END IF;

    UPDATE public.mission_progress
    SET status = 'COMPLETED', updated_at = now()
    WHERE session_id = p_session_id;
  END IF;

  UPDATE public.mission_turns
  SET k_message_id = v_k_message_id, status = 'FINALIZED',
      finalized_at = now(), updated_at = now(), error_code = NULL
  WHERE id = v_turn.id;

  RETURN QUERY SELECT v_completed, v_reward_status, false;
END;
$$;

REVOKE ALL ON FUNCTION public.start_mission_turn_v1(uuid,text,text,text,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_v2_mission_answer_pending(uuid,uuid,uuid,text,text,integer,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_mission_turn_answered_v1(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_mission_turn_v1(uuid,text,text,text,integer,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_mission_turn_v1(uuid,text,text,text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_v2_mission_answer_pending(uuid,uuid,uuid,text,text,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_mission_turn_answered_v1(uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_mission_turn_v1(uuid,text,text,text,integer,boolean) TO service_role;
