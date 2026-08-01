-- Migration: 20260801390000_mission_time_gate.sql
-- Mission time gate and forced session termination atomic RPC

CREATE OR REPLACE FUNCTION public.force_end_mission_session(p_session_id UUID)
RETURNS TABLE (
  already_ended BOOLEAN,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
  v_session_type TEXT;
BEGIN
  -- Validate that session is a mission session and get current status with row lock
  SELECT mp.status, cs.session_type 
    INTO v_status, v_session_type
  FROM public.mission_progress mp
  JOIN public.chat_sessions cs ON cs.id = mp.session_id
  WHERE mp.session_id = p_session_id
  FOR UPDATE OF mp;

  IF v_status IS NULL OR v_session_type IS NULL OR v_session_type <> 'mission' THEN
    RETURN QUERY SELECT false, 'NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  IF v_status = 'FORCE_ENDED' OR v_status = 'COMPLETED' OR v_status = 'SAFETY_PAUSED' THEN
    RETURN QUERY SELECT true, v_status;
    RETURN;
  END IF;

  UPDATE public.mission_progress
  SET status = 'FORCE_ENDED'
  WHERE session_id = p_session_id;

  UPDATE public.chat_sessions
  SET ended_at = NOW()
  WHERE id = p_session_id AND ended_at IS NULL;

  RETURN QUERY SELECT false, 'FORCE_ENDED'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.force_end_mission_session(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.force_end_mission_session(UUID) TO service_role;

