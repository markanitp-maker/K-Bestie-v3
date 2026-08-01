BEGIN;

-- Drop all overloaded versions of enqueue_collection_jobs_v3
DROP FUNCTION IF EXISTS public.enqueue_collection_jobs_v3(integer, date, uuid);
DROP FUNCTION IF EXISTS public.enqueue_collection_jobs_v3(integer, date, timestamp with time zone, uuid);

CREATE OR REPLACE FUNCTION public.enqueue_collection_jobs_v3(
  p_collection_phase integer,
  p_business_date date,
  p_execution_id uuid
)
RETURNS TABLE (
  execution_id uuid,
  cutoff_at timestamptz,
  enqueued_count integer,
  existing_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_control public.pipeline_v3_control%ROWTYPE;
  v_cutoff_at timestamptz;
  v_enqueued_count integer := 0;
  v_existing_count integer := 0;
BEGIN
  -- 1. 검증: pipeline_v3_control
  SELECT * INTO v_control FROM public.pipeline_v3_control WHERE id = 1;
  IF NOT FOUND OR v_control.enabled = false THEN
    RAISE EXCEPTION 'V3_DISABLED';
  END IF;
  IF v_control.cutover_at IS NULL THEN
    RAISE EXCEPTION 'CUTOVER_AT_IS_NULL';
  END IF;

  -- 2. 검증: phase
  IF p_collection_phase NOT IN (1, 2) THEN
    RAISE EXCEPTION 'INVALID_PHASE';
  END IF;

  -- 3. cutoff 계산
  IF p_collection_phase = 1 THEN
    v_cutoff_at := (p_business_date::text || ' 17:55:00+09')::timestamptz;
  ELSE
    v_cutoff_at := (p_business_date::text || ' 23:55:00+09')::timestamptz;
  END IF;

  -- 이미 존재하는 Job 수 계산
  SELECT COUNT(*) INTO v_existing_count 
  FROM public.pipeline_jobs
  WHERE job_type = ('collection_' || p_collection_phase::text)::public.job_type_enum
    AND business_date = p_business_date;

  -- 신규 Job 생성 (INSERT ... SELECT DISTINCT)
  WITH candidates AS (
    SELECT DISTINCT s.child_id
    FROM public.chat_messages m
    JOIN public.chat_sessions s ON m.session_id = s.id
    WHERE m.created_at <= v_cutoff_at
      AND m.created_at >= v_control.cutover_at
      AND m.collected_at IS NULL
      AND (
        (s.session_type = 'mission' AND s.mission_phase = p_collection_phase)
        OR
        (s.session_type != 'mission' AND (
           (p_collection_phase = 1 AND m.created_at > ((p_business_date - 1)::text || ' 23:55:00+09')::timestamptz AND m.created_at <= v_cutoff_at)
           OR
           (p_collection_phase = 2 AND m.created_at > (p_business_date::text || ' 17:55:00+09')::timestamptz AND m.created_at <= v_cutoff_at)
        ))
      )
  ),
  inserted AS (
    INSERT INTO public.pipeline_jobs (
      job_type,
      child_id,
      business_date,
      collection_phase,
      cutoff_at,
      execution_id,
      status,
      idempotency_key
    )
    SELECT
      ('collection_' || p_collection_phase::text)::public.job_type_enum,
      c.child_id,
      p_business_date,
      p_collection_phase,
      v_cutoff_at,
      p_execution_id,
      'pending',
      'collection_' || c.child_id::text || '_' || p_business_date::text || '_' || p_collection_phase::text || '_' || extract(epoch from v_cutoff_at)::text
    FROM candidates c
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
  )
  SELECT COUNT(*) INTO v_enqueued_count FROM inserted;

  RETURN QUERY SELECT p_execution_id, v_cutoff_at, v_enqueued_count, v_existing_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_collection_jobs_v3(integer, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_collection_jobs_v3(integer, date, uuid) TO service_role;

COMMIT;
