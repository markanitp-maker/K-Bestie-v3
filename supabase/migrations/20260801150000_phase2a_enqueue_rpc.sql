-- 20260801150000_phase2a_enqueue_rpc.sql

CREATE OR REPLACE FUNCTION enqueue_collection_jobs_v3(
  p_collection_phase integer,
  p_business_date date,
  p_cutoff timestamptz,
  p_execution_id uuid
)
RETURNS TABLE (
  enqueued_count integer,
  existing_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutover_at timestamptz;
  v_is_enabled boolean;
  v_inserted integer := 0;
  v_existing integer := 0;
  v_job_type job_type_enum;
BEGIN
  -- Admin check
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Permission denied. Must be service_role.';
  END IF;

  -- 1. Check if v3 pipeline is enabled
  SELECT enabled INTO v_is_enabled FROM pipeline_v3_control WHERE id = 1;
  IF v_is_enabled IS NULL OR v_is_enabled = false THEN
    RAISE EXCEPTION 'v3 pipeline is not enabled';
  END IF;

  -- 2. Check cutover_at
  SELECT cutover_at INTO v_cutover_at FROM pipeline_v3_control WHERE id = 1;
  IF v_cutover_at IS NULL THEN
    RAISE EXCEPTION 'cutover_at IS NULL. Cannot enqueue jobs.';
  END IF;

  -- 3. Validate phase
  IF p_collection_phase NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Invalid phase: %', p_collection_phase;
  END IF;

  v_job_type := CASE WHEN p_collection_phase = 1 THEN 'collection_1'::job_type_enum ELSE 'collection_2'::job_type_enum END;

  -- Count existing jobs for this phase/date
  SELECT count(*) INTO v_existing
  FROM pipeline_jobs
  WHERE job_type = v_job_type AND business_date = p_business_date;

  -- 5. Insert Jobs Idempotently
  WITH target_children AS (
    SELECT DISTINCT cs.child_id
    FROM chat_messages cm
    JOIN chat_sessions cs ON cm.session_id = cs.id
    WHERE cm.collected_at IS NULL
      AND cm.created_at >= v_cutover_at
      AND cm.created_at <= p_cutoff
      AND (
        (cs.session_type = 'mission' AND cs.mission_phase = p_collection_phase)
        OR
        (cs.session_type = 'free_chat' OR cs.session_type IS NULL)
      )
  ),
  inserted_jobs AS (
    INSERT INTO pipeline_jobs (
      job_type,
      child_id,
      business_date,
      idempotency_key
    )
    SELECT 
      v_job_type,
      tc.child_id,
      p_business_date,
      'collection_v3_' || v_job_type || '_' || p_business_date || '_' || tc.child_id
    FROM target_children tc
    ON CONFLICT (job_type, child_id, business_date) DO NOTHING
    RETURNING id
  )
  SELECT count(*) INTO v_inserted FROM inserted_jobs;

  RETURN QUERY SELECT v_inserted, v_existing;
END;
$$;
