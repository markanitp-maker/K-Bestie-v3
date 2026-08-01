
DROP FUNCTION IF EXISTS public.complete_context_correction_job_v3(uuid, text, uuid, uuid, date, text, text, int, int, jsonb);

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
    p_messages jsonb
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.pipeline_jobs%ROWTYPE;
  v_corrected_id uuid;
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
  INSERT INTO public.corrected_daily_conversation_messages_v3 (
    id, corrected_daily_conversation_id, source_message_id, child_id,
    session_id, role, content, created_at, section, display_sequence,
    correction_metadata, inserted_at
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
    now()
  FROM jsonb_array_elements(p_messages) AS msg
  ON CONFLICT (source_message_id) DO UPDATE
  SET 
    content = EXCLUDED.content,
    correction_metadata = EXCLUDED.correction_metadata,
    inserted_at = now();

  -- 4. Mark Job completed
  UPDATE public.pipeline_jobs
  SET status = 'completed',
      updated_at = now()
  WHERE id = p_job_id;
  
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_context_correction_job_v3(uuid, text, uuid, uuid, date, text, text, int, int, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_context_correction_job_v3(uuid, text, uuid, uuid, date, text, text, int, int, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.complete_context_correction_job_v3(uuid, text, uuid, uuid, date, text, text, int, int, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_context_correction_job_v3(uuid, text, uuid, uuid, date, text, text, int, int, jsonb) TO service_role;

