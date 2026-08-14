-- Migration: Fix force_end_mission_session_if_expired for V3 daily_single cutoff (23:50:00 KST)
-- Supports V3 daily_single (23:50 KST), V2 round2_night (Next day 00:00 KST), and V2 round1_day (17:50 KST).

CREATE OR REPLACE FUNCTION public.force_end_mission_session_if_expired(p_session_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_session public.chat_sessions%ROWTYPE;
  v_kst_started timestamptz;
  v_started_date date;
  v_round text := 'round1_day';
  v_cutoff timestamptz;
BEGIN
  SELECT * INTO v_session
  FROM public.chat_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND';
  END IF;

  IF v_session.session_type != 'mission' THEN
    RAISE EXCEPTION 'NOT_A_MISSION_SESSION';
  END IF;

  IF v_session.ended_at IS NOT NULL THEN
    RETURN 'ALREADY_ENDED';
  END IF;

  SELECT round_type INTO v_round
  FROM public.mission_progress
  WHERE session_id = p_session_id
  LIMIT 1;

  v_kst_started := v_session.started_at AT TIME ZONE 'Asia/Seoul';
  v_started_date := v_kst_started::date;

  IF v_round = 'daily_single' THEN
    v_cutoff := (v_started_date::text || ' 23:50:00+09')::timestamptz;
  ELSIF v_round = 'round2_night' THEN
    v_cutoff := ((v_started_date + 1)::text || ' 00:00:00+09')::timestamptz;
  ELSE
    v_cutoff := (v_started_date::text || ' 17:50:00+09')::timestamptz;
  END IF;

  IF now() < v_cutoff THEN
    RETURN 'NOT_EXPIRED';
  END IF;

  UPDATE public.chat_sessions
  SET ended_at = now(),
      ended_reason = 'FORCE_ENDED'
  WHERE id = p_session_id;

  UPDATE public.mission_progress
  SET status = 'FORCE_ENDED',
      updated_at = now()
  WHERE session_id = p_session_id;

  RETURN 'FORCE_ENDED';
END;
$function$;
