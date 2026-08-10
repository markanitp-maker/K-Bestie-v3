-- 073 Mission v3 Phase 4: existing gold_key_ledger extension only.
-- Historical ledger rows are neither updated nor deleted. Mission v3 uses a
-- dedicated reward type so legacy Mission I/II reward paths remain untouched.
--
-- 2026-08-10 correction (claude-review-073-phase4 게이트①):
--   R1: master request §16 explicitly forbids a "mission start" reward — only
--       one reward type exists (mission complete, Goal 3/4+). The original
--       draft's mission_v3_start type is removed entirely.
--   R2: finalize_mission_turn_v1 (20260807190000) is the only writer of
--       mission_progress.status='COMPLETED' today. If a future route ever
--       calls it for a v3_single_daily session it would grant the legacy
--       'mission_complete' reward *and* satisfy this RPC's status='COMPLETED'
--       precondition — a cross-path double payment. This migration adds a
--       CREATE OR REPLACE guard so that function never auto-completes or
--       rewards a v3_single_daily session; only award_mission_v3_reward may.
--   R3: the CHECK constraint no longer requires source_session_id IS NOT NULL
--       (matches the 089 freechat CHECK) so child deletion's
--       chat_sessions -> ON DELETE SET NULL cascade never trips a check
--       violation on existing reward rows.
--   R4: the original draft used `INSERT ... RETURNING true INTO v_inserted`
--       and checked `IF NOT v_inserted`, but plpgsql sets a RETURNING target
--       to NULL (not false) when ON CONFLICT DO NOTHING matches zero rows, so
--       that check never fired. The RPC now drops the RETURNING clause and
--       checks the statement's own `FOUND` flag directly, which plpgsql sets
--       to true/false correctly for INSERT row counts.
--
-- 2026-08-11 correction (claude-review-073-phase4-r2, F1):
--   The R2 fix above correctly stopped finalize_mission_turn_v1 from
--   auto-completing v3_single_daily sessions, but nothing replaced it as a
--   completion writer — award_mission_v3_reward only *checked* for
--   status='COMPLETED', it never *set* it, so v3 missions could never
--   actually complete or get rewarded. Fixed by having this RPC set
--   status='COMPLETED' itself once Goal 3/4+ is satisfied (the master §16.1
--   completion criterion), which also fires the existing
--   trg_mission_progress_event_completion trigger for master §17.4's
--   "completion = event +1" for free.

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
        reward_type IS DISTINCT FROM 'mission_v3_complete'
        OR (
          reason = 'mission'
          AND business_date IS NOT NULL
        )
      ) NOT VALID;
  END IF;
END
$migration$;

ALTER TABLE public.gold_key_ledger
  VALIDATE CONSTRAINT gold_key_ledger_mission_v3_source_check;

CREATE UNIQUE INDEX IF NOT EXISTS gold_key_ledger_mission_v3_daily_reward_unique
  ON public.gold_key_ledger (child_id, business_date, reward_type)
  WHERE business_date IS NOT NULL
    AND reward_type = 'mission_v3_complete';

COMMENT ON INDEX public.gold_key_ledger_mission_v3_daily_reward_unique IS
  'Mission v3 idempotency key: child_id + business_date + reward_type. One complete-reward ledger row per KST business day.';

-- R2: guard the legacy turn-finalize path so it can never auto-complete or
-- reward a v3_single_daily session. Signature/return type are unchanged —
-- CREATE OR REPLACE is a drop-in swap, safe to reapply.
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

  -- R2: v3_single_daily sessions are never auto-completed or rewarded through
  -- this legacy path. Only award_mission_v3_reward may complete/reward them,
  -- keyed off Goal satisfaction rather than valid_answer_count.
  v_completed := v_progress.mission_policy_version IS DISTINCT FROM 'v3_single_daily'
    AND COALESCE(v_progress.valid_answer_count, 0) >= COALESCE(v_progress.required_valid_count, 5);

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

REVOKE ALL ON FUNCTION public.finalize_mission_turn_v1(uuid,text,text,text,integer,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_mission_turn_v1(uuid,text,text,text,integer,boolean) TO service_role;

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
  ON CONFLICT (child_id, business_date, reward_type)
    WHERE business_date IS NOT NULL
      AND reward_type = 'mission_v3_complete'
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

COMMIT;
