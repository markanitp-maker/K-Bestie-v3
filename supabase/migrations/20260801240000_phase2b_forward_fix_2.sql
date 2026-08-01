CREATE OR REPLACE FUNCTION public.enqueue_context_correction_job_v3(
  p_child_id uuid,
  p_business_date date,
  p_execution_id uuid DEFAULT NULL
) RETURNS TABLE(enqueued_count integer, existing_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_control record;
  v_collection2_status text;
  v_raw_v3_exists boolean;
  v_existing_job uuid;
  v_already_corrected boolean;
  v_idempotency_key text;
  v_enqueued integer := 0;
  v_existing integer := 0;
BEGIN
  -- 1. Input Validation
  IF p_child_id IS NULL OR p_business_date IS NULL THEN
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
      AND correction_status = 'completed'
  ) INTO v_already_corrected;

  IF v_already_corrected THEN
    RAISE EXCEPTION 'ALREADY_CORRECTED';
  END IF;

  -- 6. Enqueue Job with idempotency
  v_idempotency_key := p_child_id::text || ':' || p_business_date::text || ':context_correction';

  SELECT id INTO v_existing_job FROM public.pipeline_jobs
  WHERE idempotency_key = v_idempotency_key;

  IF v_existing_job IS NOT NULL THEN
    v_existing := 1;
  ELSE
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
    );
    v_enqueued := 1;
  END IF;

  RETURN QUERY SELECT v_enqueued, v_existing;
END;
$$;
