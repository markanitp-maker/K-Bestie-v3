-- 089: serialize every active Mission completion reward writer behind one
-- child/business-date uniqueness policy. Historical ledger rows are untouched.
-- Apply only after checking existing mission_complete/mission_v3_complete rows
-- for duplicate (child_id, business_date) pairs.
-- Note: no explicit BEGIN/COMMIT here — scripts/apply-migration.js rejects
-- top-level transaction control and provides its own implicit-transaction
-- atomicity via a single simple-query HTTP call (see migrationSafety.js).

DROP INDEX IF EXISTS public.gold_key_ledger_mission_daily_reward_unique;

-- 게이트①(claude-review) S4 지적: 새 2컬럼 인덱스가 이 3컬럼 인덱스를 완전히
-- 대체·포괄한다. 구 인덱스를 남겨두면 "제약의 단일 출처"가 둘로 갈라진다.
DROP INDEX IF EXISTS public.gold_key_ledger_mission_v3_daily_reward_unique;

CREATE UNIQUE INDEX gold_key_ledger_mission_daily_reward_unique
  ON public.gold_key_ledger (child_id, business_date)
  WHERE reward_type IN ('mission_complete', 'mission_v3_complete');

COMMENT ON INDEX public.gold_key_ledger_mission_daily_reward_unique IS
  'One Mission completion reward across V1/V2/V3 per child and KST business date.';

CREATE OR REPLACE FUNCTION public.award_mission_v1_reward_key(
  p_child_id uuid,
  p_mission_id uuid DEFAULT NULL,
  p_reward_type text DEFAULT 'mission_complete'
)
RETURNS TABLE (
  awarded boolean,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_date date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_active_balance integer := 0;
BEGIN
  IF p_child_id IS NULL THEN
    RAISE EXCEPTION 'child_id_required' USING ERRCODE = '22023';
  END IF;
  IF p_reward_type <> 'mission_complete' THEN
    RAISE EXCEPTION 'invalid Mission v1 reward_type: %', p_reward_type
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_child_id::text));

  -- Preserve the legacy mission_id idempotency key before applying wallet
  -- limits, so a retry reports already_earned even when the balance is full.
  IF p_mission_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.gold_key_ledger
    WHERE child_id = p_child_id
      AND mission_id = p_mission_id
      AND reward_type = p_reward_type
  ) THEN
    RETURN QUERY SELECT false, 'already_earned'::text;
    RETURN;
  END IF;

  SELECT count(*)::integer INTO v_active_balance
  FROM public.gold_key_ledger
  WHERE child_id = p_child_id
    AND consumed = false
    AND expires_at > now();

  IF v_active_balance >= 22 THEN
    RETURN QUERY SELECT false, 'balance_limit_reached'::text;
    RETURN;
  END IF;

  INSERT INTO public.gold_key_ledger (
    child_id,
    reason,
    expires_at,
    mission_id,
    reward_type,
    business_date
  ) VALUES (
    p_child_id,
    'mission',
    now() + interval '7 days',
    p_mission_id,
    p_reward_type,
    v_business_date
  )
  ON CONFLICT (child_id, business_date)
    WHERE reward_type IN ('mission_complete', 'mission_v3_complete')
  DO NOTHING;

  IF FOUND THEN
    RETURN QUERY SELECT true, NULL::text;
  ELSE
    RETURN QUERY SELECT false, 'daily_limit_reached'::text;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.award_mission_v1_reward_key(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_mission_v1_reward_key(uuid,uuid,text)
  TO service_role;

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
    -- Keep the turn lock above for turn idempotency; this child lock separately
    -- serializes the shared wallet balance check across all reward writers.
    PERFORM pg_advisory_xact_lock(hashtext(v_session.child_id::text));

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
        WHERE reward_type IN ('mission_complete', 'mission_v3_complete')
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
  -- 게이트①(claude-review) S1 지적: 다른 3개 writer는 reward_type을 RAISE로
  -- 강제하는데 이 함수만 파라미터를 검증 없이 그대로 INSERT했다 — 잘못된 값이
  -- 들어오면 공유 부분 인덱스 대상에서 빠져 ON CONFLICT가 영영 발동하지 않는다.
  IF p_reward_type <> 'mission_complete' THEN
    RAISE EXCEPTION 'invalid record_v2_mission_answer reward_type: %', p_reward_type
      USING ERRCODE = '22023';
  END IF;

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
          WHERE reward_type IN ('mission_complete', 'mission_v3_complete')
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

  IF v_goal_count <> 4 THEN
    RETURN QUERY SELECT false, false, 'goals_not_initialized', p_reward_type,
      p_business_date, v_satisfied_goal_count;
    RETURN;
  END IF;

  IF v_satisfied_goal_count < 3 THEN
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
$$;

REVOKE EXECUTE ON FUNCTION public.award_mission_v3_reward(
  uuid, date, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_mission_v3_reward(
  uuid, date, text, uuid
) TO service_role;
