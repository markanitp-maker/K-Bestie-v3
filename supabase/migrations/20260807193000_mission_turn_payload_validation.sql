-- 069 follow-up: reject invalid/tampered payloads before any child message is persisted.
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
  v_question_ids uuid[];
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

  SELECT mp.question_ids INTO v_question_ids
  FROM public.mission_progress mp
  WHERE mp.session_id = p_session_id
  FOR SHARE;
  IF NOT FOUND OR NOT (p_question_id::uuid = ANY(COALESCE(v_question_ids, ARRAY[]::uuid[]))) THEN
    RAISE EXCEPTION 'question_not_in_mission_session' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_turn
  FROM public.mission_turns
  WHERE session_id = p_session_id AND client_turn_id = p_client_turn_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_turn.question_id <> p_question_id OR EXISTS (
      SELECT 1 FROM public.chat_messages cm
      WHERE cm.id = v_turn.child_message_id AND cm.content <> p_answer_text
    ) THEN
      RAISE EXCEPTION 'client_turn_payload_conflict' USING ERRCODE = '22023';
    END IF;
    UPDATE public.mission_turns
    SET attempt_count = attempt_count + 1,
        updated_at = CASE
          WHEN v_turn.answer_result IS NULL AND v_turn.updated_at <= now() - interval '30 seconds'
            THEN now()
          ELSE updated_at
        END
    WHERE id = v_turn.id;
    RETURN QUERY SELECT v_turn.status, v_turn.answer_result,
      (v_turn.answer_result IS NOT NULL OR v_turn.updated_at > now() - interval '30 seconds');
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
    p_session_id, p_client_turn_id, p_question_id, v_message_id
  );

  RETURN QUERY SELECT 'CHILD_PERSISTED'::text, NULL::jsonb, false;
END;
$$;

REVOKE ALL ON FUNCTION public.start_mission_turn_v1(uuid,text,text,text,text,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_mission_turn_v1(uuid,text,text,text,text,integer)
  TO service_role;
