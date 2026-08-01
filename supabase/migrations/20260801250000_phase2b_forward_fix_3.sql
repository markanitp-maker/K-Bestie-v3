-- 1. DROP old function signature to prevent duplicate overloads
DROP FUNCTION IF EXISTS public.enqueue_context_correction_job_v3(uuid, date, uuid);

-- 2. CREATE exact required signature
CREATE OR REPLACE FUNCTION public.enqueue_context_correction_job_v3(
  p_child_id uuid,
  p_business_date date,
  p_execution_id uuid
) RETURNS TABLE(enqueued_count integer, existing_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_control record;
  v_collection2_status text;
  v_raw_v3_exists boolean;
  v_already_corrected boolean;
  v_idempotency_key text;
  v_enqueued integer := 0;
  v_existing integer := 0;
BEGIN
  -- 1. Input Validation
  IF p_child_id IS NULL OR p_business_date IS NULL OR p_execution_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  -- 2. Check V3 Control Flag
  SELECT * INTO v_control FROM public.pipeline_v3_control WHERE id = 1;
  IF NOT v_control.enabled OR v_control.cutover_at IS NULL THEN
    RAISE EXCEPTION 'V3_DISABLED';
  END IF;

  -- 3. Check Collection 2 status
  SELECT status INTO v_collection2_status 
  FROM public.pipeline_jobs 
  WHERE child_id = p_child_id 
    AND business_date = p_business_date 
    AND job_type = 'collection_2'
  ORDER BY created_at DESC 
  LIMIT 1;

  IF v_collection2_status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'COLLECTION_2_NOT_COMPLETED';
  END IF;

  -- 4. Check Raw V3 Existence
  SELECT EXISTS (
    SELECT 1 FROM public.raw_daily_conversations_v3 
    WHERE child_id = p_child_id AND business_date = p_business_date
  ) INTO v_raw_v3_exists;

  IF NOT v_raw_v3_exists THEN
    RAISE EXCEPTION 'RAW_V3_MISSING';
  END IF;

  -- 5. Check if already corrected
  SELECT EXISTS (
    SELECT 1 FROM public.corrected_daily_conversations_v3 
    WHERE child_id = p_child_id 
      AND business_date = p_business_date 
      AND (correction_status = 'completed' OR status = 'completed')
  ) INTO v_already_corrected;

  IF v_already_corrected THEN
    -- Check if raw messages count or content changed since correction
    IF EXISTS (
      SELECT 1 FROM public.raw_daily_conversations_v3 r
      JOIN public.corrected_daily_conversations_v3 c ON r.child_id = c.child_id AND r.business_date = c.business_date
      WHERE r.child_id = p_child_id AND r.business_date = p_business_date AND r.updated_at > c.updated_at
    ) THEN
      UPDATE public.corrected_daily_conversations_v3
      SET correction_status = 'pending', status = 'pending', updated_at = now()
      WHERE child_id = p_child_id AND business_date = p_business_date;

      UPDATE public.pipeline_jobs
      SET status = 'pending', attempt_count = 0, claimed_by = NULL, claimed_at = NULL, last_error_code = NULL, last_error_summary = NULL, updated_at = now()
      WHERE child_id = p_child_id AND business_date = p_business_date AND job_type IN ('context_correction', 'memory_batch', 'daily_report');
    ELSE
      -- Exact duplicate: return success without throwing ALREADY_CORRECTED exception
      RETURN QUERY SELECT 0, 1;
      RETURN;
    END IF;
  END IF;

  -- 6. Enqueue Job with idempotency (INSERT ... ON CONFLICT)
  v_idempotency_key := p_child_id::text || ':' || p_business_date::text || ':context_correction';

  INSERT INTO public.pipeline_jobs (
    job_type,
    status,
    child_id,
    business_date,
    idempotency_key,
    execution_id
  ) VALUES (
    'context_correction',
    'pending',
    p_child_id,
    p_business_date,
    v_idempotency_key,
    p_execution_id
  )
  ON CONFLICT (idempotency_key) DO UPDATE SET
    execution_id = p_execution_id,
    updated_at = now();

  IF FOUND THEN
    v_enqueued := 1;
  ELSE
    v_existing := 1;
  END IF;

  RETURN QUERY SELECT v_enqueued, v_existing;
END;
$$;

ALTER FUNCTION public.enqueue_context_correction_job_v3(uuid, date, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_context_correction_job_v3(uuid, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_context_correction_job_v3(uuid, date, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_context_correction_job_v3(uuid, date, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_context_correction_job_v3(uuid, date, uuid) TO service_role;
