-- Update existing claim_pipeline_jobs to only claim collection_1 and collection_2
CREATE OR REPLACE FUNCTION public.claim_pipeline_jobs(p_claimed_by text, p_limit integer)
 RETURNS SETOF pipeline_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'INVALID_LIMIT';
  END IF;

  RETURN QUERY
  WITH available AS (
    SELECT id
    FROM public.pipeline_jobs
    WHERE job_type IN ('collection_1', 'collection_2')
      AND (status = 'pending' OR (status = 'retry_wait' AND next_retry_at <= now()) OR (status = 'processing' AND claim_expires_at <= now()))
      AND attempt_count < max_attempts
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.pipeline_jobs j
  SET status = 'processing',
      claimed_by = p_claimed_by,
      claimed_at = now(),
      claim_expires_at = now() + interval '5 minutes',
      attempt_count = attempt_count + 1,
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  FROM available a
  WHERE j.id = a.id
  RETURNING j.*;
END;
$function$;

-- Create new claim_context_correction_jobs_v3
CREATE OR REPLACE FUNCTION public.claim_context_correction_jobs_v3(p_claimed_by text, p_limit integer)
 RETURNS SETOF pipeline_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'INVALID_LIMIT';
  END IF;

  RETURN QUERY
  WITH available AS (
    SELECT id
    FROM public.pipeline_jobs
    WHERE job_type = 'context_correction'
      AND (status = 'pending' OR (status = 'retry_wait' AND next_retry_at <= now()) OR (status = 'processing' AND claim_expires_at <= now()))
      AND attempt_count < max_attempts
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.pipeline_jobs j
  SET status = 'processing',
      claimed_by = p_claimed_by,
      claimed_at = now(),
      claim_expires_at = now() + interval '5 minutes',
      attempt_count = attempt_count + 1,
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  FROM available a
  WHERE j.id = a.id
  RETURNING j.*;
END;
$function$;

-- REVOKE ALL and GRANT service_role
REVOKE ALL ON FUNCTION public.claim_context_correction_jobs_v3(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_context_correction_jobs_v3(text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.claim_context_correction_jobs_v3(text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_context_correction_jobs_v3(text, integer) TO service_role;

-- complete_context_correction_job_v3
CREATE OR REPLACE FUNCTION public.complete_context_correction_job_v3(
    p_job_id uuid,
    p_claimed_by text,
    p_raw_daily_conversation_v3_id uuid,
    p_child_id uuid,
    p_business_date date,
    p_model text,
    p_prompt_version text,
    p_source_message_count int,
    p_corrected_message_count int,
    p_messages jsonb -- array of message objects
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.pipeline_jobs%ROWTYPE;
  v_corrected_id uuid;
  v_msg record;
BEGIN
  -- 1. Check Job validity
  SELECT * INTO v_job FROM public.pipeline_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;
  
  IF v_job.status != 'processing' THEN
    RAISE EXCEPTION 'JOB_NOT_PROCESSING';
  END IF;
  
  IF v_job.claimed_by != p_claimed_by THEN
    RAISE EXCEPTION 'CLAIMED_BY_MISMATCH';
  END IF;
  
  IF v_job.claim_expires_at <= now() THEN
    RAISE EXCEPTION 'CLAIM_EXPIRED';
  END IF;

  -- 2. Upsert corrected_daily_conversations_v3
  INSERT INTO public.corrected_daily_conversations_v3 (
    id, raw_daily_conversation_v3_id, child_id, business_date, correction_status, status,
    model, prompt_version, source_message_count, corrected_message_count,
    completed_at, created_at, updated_at
  )
  VALUES (
    gen_random_uuid(), p_raw_daily_conversation_v3_id, p_child_id, p_business_date, 'completed', 'completed',
    p_model, p_prompt_version, p_source_message_count, p_corrected_message_count,
    now(), now(), now()
  )
  ON CONFLICT (child_id, business_date) DO UPDATE
  SET 
    correction_status = 'completed',
    status = 'completed',
    model = p_model,
    prompt_version = p_prompt_version,
    source_message_count = p_source_message_count,
    corrected_message_count = p_corrected_message_count,
    completed_at = now(),
    updated_at = now()
  RETURNING id INTO v_corrected_id;

  -- 3. Insert messages
  -- Because JSONB array iteration is tricky, we can use jsonb_to_recordset
  -- We assume p_messages contains: source_message_id, session_id, role, content, original_created_at, section, display_sequence, correction_metadata
  INSERT INTO public.corrected_daily_conversation_messages_v3 (
    id, corrected_daily_conversation_id, source_message_id, child_id,
    session_id, role, content, original_created_at, section, display_sequence,
    correction_metadata, created_at, updated_at
  )
  SELECT 
    gen_random_uuid(),
    v_corrected_id,
    (msg->>'source_message_id')::uuid,
    p_child_id,
    (msg->>'session_id')::uuid,
    msg->>'role',
    msg->>'content',
    (msg->>'original_created_at')::timestamptz,
    msg->>'section',
    (msg->>'display_sequence')::int,
    msg->'correction_metadata',
    now(),
    now()
  FROM jsonb_array_elements(p_messages) AS msg
  ON CONFLICT (source_message_id) DO UPDATE
  SET 
    content = EXCLUDED.content,
    correction_metadata = EXCLUDED.correction_metadata,
    updated_at = now();

  -- 4. Mark Job completed
  UPDATE public.pipeline_jobs
  SET status = 'completed',
      updated_at = now()
  WHERE id = p_job_id;
  
END;
$function$;

-- REVOKE ALL and GRANT service_role
REVOKE ALL ON FUNCTION public.complete_context_correction_job_v3(uuid, text, uuid, uuid, date, text, text, int, int, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_context_correction_job_v3(uuid, text, uuid, uuid, date, text, text, int, int, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.complete_context_correction_job_v3(uuid, text, uuid, uuid, date, text, text, int, int, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_context_correction_job_v3(uuid, text, uuid, uuid, date, text, text, int, int, jsonb) TO service_role;
