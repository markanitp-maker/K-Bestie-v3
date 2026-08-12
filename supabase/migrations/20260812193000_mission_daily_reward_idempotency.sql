-- 089: legacy V2 dual-round Mission completion rewards are limited to one
-- Gold Key per child and KST business date. Historical ledger rows remain
-- untouched; only rewards inserted after this migration receive business_date.

CREATE UNIQUE INDEX IF NOT EXISTS gold_key_ledger_mission_daily_reward_unique
  ON public.gold_key_ledger (child_id, business_date)
  WHERE reward_type = 'mission_complete';

COMMENT ON INDEX public.gold_key_ledger_mission_daily_reward_unique IS
  'Legacy Mission V2 idempotency key: one mission_complete reward per child and KST business date.';

-- The reward writer lives in finalize_mission_turn_v1. The pending answer RPC
-- only persists progress and deliberately stops before completion/reward.
-- Keep the Mission v3 guard introduced by 20260810230000 intact.
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
  v_business_date date := (now() AT TIME ZONE 'Asia/Seoul')::date;
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

  -- v3_single_daily is completed and rewarded only by award_mission_v3_reward.
  v_completed := v_progress.mission_policy_version IS DISTINCT FROM 'v3_single_daily'
    AND COALESCE(v_progress.valid_answer_count, 0) >= COALESCE(v_progress.required_valid_count, 5);

  IF v_completed THEN
    SELECT count(*)::integer INTO v_active_balance
    FROM public.gold_key_ledger
    WHERE child_id = v_session.child_id AND consumed = false AND expires_at > now();

    IF EXISTS (
      SELECT 1 FROM public.gold_key_ledger
      WHERE child_id = v_session.child_id AND mission_id = p_session_id
        AND reward_type = 'mission_complete'
    ) THEN
      v_reward_status := 'already_earned';
    ELSIF v_active_balance >= 22 THEN
      v_reward_status := 'balance_limit_reached';
    ELSE
      INSERT INTO public.gold_key_ledger (
        child_id, reason, expires_at, mission_id, reward_type, business_date
      ) VALUES (
        v_session.child_id, 'mission', now() + interval '7 days',
        p_session_id, 'mission_complete', v_business_date
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

REVOKE ALL ON FUNCTION public.finalize_mission_turn_v1(uuid,text,text,text,integer,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_mission_turn_v1(uuid,text,text,text,integer,boolean)
  TO service_role;
