-- Recreate enqueue_collection_jobs_v3 with correct return table
DROP FUNCTION IF EXISTS public.enqueue_collection_jobs_v3(integer, date, uuid, uuid, timestamptz, boolean);

CREATE OR REPLACE FUNCTION public.enqueue_collection_jobs_v3(
  p_collection_phase integer,
  p_business_date date,
  p_execution_id uuid,
  p_child_id uuid DEFAULT NULL,
  p_cutoff_at timestamptz DEFAULT NULL,
  p_include_downstream boolean DEFAULT false
)
RETURNS TABLE (
  out_execution_id uuid,
  cutoff_at timestamptz,
  enqueued_count integer,
  existing_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_v3_enabled boolean;
  v_job_type text;
  v_cutoff timestamptz;
  v_sched_start timestamptz;
  v_sched_end timestamptz;
  v_target RECORD;
  v_enqueued integer := 0;
  v_existing integer := 0;
BEGIN
  SELECT enabled INTO v_v3_enabled FROM public.pipeline_v3_control WHERE id = 1;
  IF v_v3_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'V3_DISABLED';
  END IF;

  IF p_collection_phase NOT IN (1, 2) THEN
    RAISE EXCEPTION 'INVALID_PHASE';
  END IF;

  v_job_type := CASE WHEN p_collection_phase = 1 THEN 'collection_1' ELSE 'collection_2' END;

  IF p_collection_phase = 1 THEN
    v_sched_start := (p_business_date::text || ' 00:00:00+09')::timestamptz;
    v_sched_end := (p_business_date::text || ' 17:55:00+09')::timestamptz;
  ELSE
    v_sched_start := (p_business_date::text || ' 00:00:00+09')::timestamptz;
    v_sched_end := ((p_business_date + 1)::text || ' 00:00:00+09')::timestamptz;
  END IF;

  IF p_cutoff_at IS NOT NULL THEN
    IF p_cutoff_at >= v_sched_start AND p_cutoff_at <= v_sched_end AND p_cutoff_at <= now() THEN
      v_cutoff := p_cutoff_at;
    ELSE
      RAISE EXCEPTION 'INVALID_CUTOFF';
    END IF;
  ELSE
    v_cutoff := v_sched_end;
  END IF;

  IF p_child_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.child_profiles WHERE id = p_child_id) THEN
      RAISE EXCEPTION 'CHILD_NOT_FOUND';
    END IF;
    IF p_include_downstream AND p_collection_phase = 2 THEN
      INSERT INTO public.pipeline_execution_items (execution_id, child_id, business_date, job_type, status, item_key, updated_at)
      VALUES 
        (p_execution_id, p_child_id, p_business_date, 'context_correction', 'pending', 'context_correction', now()),
        (p_execution_id, p_child_id, p_business_date, 'memory_batch', 'pending', 'memory_batch', now()),
        (p_execution_id, p_child_id, p_business_date, 'daily_report', 'pending', 'daily_report', now())
      ON CONFLICT (execution_id, child_id, item_key) DO UPDATE SET
        status = CASE WHEN pipeline_execution_items.status IN ('completed', 'failed') THEN pipeline_execution_items.status ELSE 'pending' END,
        updated_at = now()
      WHERE pipeline_execution_items.status NOT IN ('completed', 'failed');
    END IF;
    PERFORM public.enqueue_pipeline_job_v3(v_job_type, p_child_id, p_business_date, p_execution_id, p_collection_phase, v_cutoff);

    v_enqueued := 1;
  ELSE
    FOR v_target IN 
      SELECT DISTINCT s.child_id
      FROM public.chat_messages m
      JOIN public.chat_sessions s ON m.session_id = s.id
      WHERE m.created_at >= v_sched_start
        AND m.created_at < v_cutoff
        AND m.collected_at IS NULL
        AND (
          (s.session_type = 'mission' AND (
            (p_collection_phase = 1 AND s.mission_phase = 1) OR
            (p_collection_phase = 2 AND s.mission_phase IN (1, 2))
          )) OR
          (s.session_type != 'mission')
        )
    LOOP
      IF p_include_downstream AND p_collection_phase = 2 THEN
        INSERT INTO public.pipeline_execution_items (execution_id, child_id, business_date, job_type, status, item_key, updated_at)
        VALUES 
          (p_execution_id, v_target.child_id, p_business_date, 'context_correction', 'pending', 'context_correction', now()),
          (p_execution_id, v_target.child_id, p_business_date, 'memory_batch', 'pending', 'memory_batch', now()),
          (p_execution_id, v_target.child_id, p_business_date, 'daily_report', 'pending', 'daily_report', now())
        ON CONFLICT (execution_id, child_id, item_key) DO UPDATE SET
          status = CASE WHEN pipeline_execution_items.status IN ('completed', 'failed') THEN pipeline_execution_items.status ELSE 'pending' END,
          updated_at = now()
        WHERE pipeline_execution_items.status NOT IN ('completed', 'failed');
      END IF;
      PERFORM public.enqueue_pipeline_job_v3(v_job_type, v_target.child_id, p_business_date, p_execution_id, p_collection_phase, v_cutoff);

      v_enqueued := v_enqueued + 1;
    END LOOP;
  END IF;

  SELECT count(*)::integer INTO v_existing
  FROM public.pipeline_jobs
  WHERE job_type = v_job_type::public.job_type_enum
    AND business_date = p_business_date;

  RETURN QUERY SELECT p_execution_id, v_cutoff, v_enqueued, v_existing;
END;
$$;

-- Set cutover_at
UPDATE public.pipeline_v3_control SET cutover_at = '2025-01-01T00:00:00Z' WHERE id = 1 AND cutover_at IS NULL;
