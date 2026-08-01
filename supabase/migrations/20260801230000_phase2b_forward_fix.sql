-- Phase 2B Context Correction V3 Forward Fix
-- Existing `corrected_daily_conversations_v3` table is preserved and extended via ADD COLUMN IF NOT EXISTS.
-- Enum `context_correction` is already present in `job_type_enum`.

-- 1. ADD COLUMNs to corrected_daily_conversations_v3
ALTER TABLE public.corrected_daily_conversations_v3
  ADD COLUMN IF NOT EXISTS source_raw_id uuid REFERENCES public.raw_daily_conversations_v3(id),
  ADD COLUMN IF NOT EXISTS status text CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS prompt_version text,
  ADD COLUMN IF NOT EXISTS corrected_payload jsonb,
  ADD COLUMN IF NOT EXISTS source_message_count integer,
  ADD COLUMN IF NOT EXISTS corrected_message_count integer,
  ADD COLUMN IF NOT EXISTS validation_error text;
-- (child_id, business_date) UNIQUE constraint already exists via idx_corrected_v3_child_date or existing constraint.

-- 2. CREATE TABLE corrected_daily_conversation_messages_v3
CREATE TABLE IF NOT EXISTS public.corrected_daily_conversation_messages_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corrected_daily_conversation_id uuid NOT NULL REFERENCES public.corrected_daily_conversations_v3(id) ON DELETE CASCADE,
  child_id uuid NOT NULL,
  business_date date NOT NULL,
  source_message_id uuid NOT NULL UNIQUE,
  session_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone NOT NULL,
  section text NOT NULL CHECK (section IN ('mission_1', 'free_chat_1', 'mission_2', 'free_chat_2')),
  display_sequence integer NOT NULL,
  correction_metadata jsonb,
  inserted_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_corr_msg_v3_child_date ON public.corrected_daily_conversation_messages_v3(child_id, business_date);
CREATE INDEX IF NOT EXISTS idx_corr_msg_v3_conv_seq ON public.corrected_daily_conversation_messages_v3(corrected_daily_conversation_id, display_sequence);

-- 3. Permissions for corrected_daily_conversation_messages_v3
ALTER TABLE public.corrected_daily_conversation_messages_v3 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only_corr_msg_v3" 
  ON public.corrected_daily_conversation_messages_v3 
  AS PERMISSIVE 
  FOR ALL 
  TO service_role 
  USING (true);

-- Revoke all from anon and authenticated just in case
REVOKE ALL ON public.corrected_daily_conversation_messages_v3 FROM anon, authenticated;
-- Similarly, ensure public.corrected_daily_conversations_v3 revokes anon/authenticated if not already
REVOKE ALL ON public.corrected_daily_conversations_v3 FROM anon, authenticated;

-- Change owner to postgres (standard)
ALTER TABLE public.corrected_daily_conversation_messages_v3 OWNER TO postgres;

-- 4. RPC for enqueue_context_correction_job_v3
CREATE OR REPLACE FUNCTION public.enqueue_context_correction_job_v3(
  p_child_id uuid,
  p_business_date date,
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
  v_control record;
  v_collection_job record;
  v_raw_v3_id uuid;
  v_existing_job_id uuid;
  v_existing_corr record;
  v_inserted_id uuid;
  v_idempotency_key text;
BEGIN
  -- 1) Validate input
  IF p_child_id IS NULL OR p_business_date IS NULL OR p_execution_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  -- 2) Check pipeline control
  SELECT * INTO v_control FROM public.pipeline_v3_control WHERE id = 1;
  IF v_control IS NULL OR v_control.enabled = false OR v_control.cutover_at IS NULL THEN
    RAISE EXCEPTION 'V3_DISABLED';
  END IF;

  -- 3) Check Collection 2 completion
  -- We assume Collection 2 jobs for this child and date must be 'completed'
  SELECT * INTO v_collection_job 
  FROM public.pipeline_jobs 
  WHERE job_type = 'collection_2' 
    AND child_id = p_child_id 
    AND business_date = p_business_date 
    AND status = 'completed'
  LIMIT 1;

  IF v_collection_job IS NULL THEN
    RAISE EXCEPTION 'COLLECTION_2_NOT_COMPLETED';
  END IF;

  -- 4) Check Raw V3 existence
  SELECT id INTO v_raw_v3_id
  FROM public.raw_daily_conversations_v3
  WHERE child_id = p_child_id AND business_date = p_business_date
  LIMIT 1;

  IF v_raw_v3_id IS NULL THEN
    RAISE EXCEPTION 'RAW_V3_MISSING';
  END IF;

  -- 5) Check if already corrected and completed
  SELECT * INTO v_existing_corr
  FROM public.corrected_daily_conversations_v3
  WHERE child_id = p_child_id AND business_date = p_business_date
  LIMIT 1;

  IF v_existing_corr IS NOT NULL AND (v_existing_corr.status = 'completed' OR v_existing_corr.correction_status = 'completed') THEN
    RAISE EXCEPTION 'ALREADY_CORRECTED';
  END IF;

  -- 6) Check if job already exists (Idempotency key)
  v_idempotency_key := 'context_correction_' || p_child_id::text || '_' || to_char(p_business_date, 'YYYYMMDD');

  SELECT id INTO v_existing_job_id
  FROM public.pipeline_jobs
  WHERE idempotency_key = v_idempotency_key
  LIMIT 1;

  IF v_existing_job_id IS NOT NULL THEN
    RETURN QUERY SELECT 0, 1;
    RETURN;
  END IF;

  -- 7) Insert new job
  INSERT INTO public.pipeline_jobs (
    job_type,
    status,
    priority,
    child_id,
    business_date,
    idempotency_key,
    execution_id
  ) VALUES (
    'context_correction',
    'pending',
    1,
    p_child_id,
    p_business_date,
    v_idempotency_key,
    p_execution_id
  ) RETURNING id INTO v_inserted_id;

  RETURN QUERY SELECT 1, 0;
END;
$$;

ALTER FUNCTION public.enqueue_context_correction_job_v3(uuid, date, uuid) OWNER TO postgres;

-- Revoke execute from public/anon/authenticated and grant to service_role
REVOKE EXECUTE ON FUNCTION public.enqueue_context_correction_job_v3(uuid, date, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_context_correction_job_v3(uuid, date, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.enqueue_context_correction_job_v3(uuid, date, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_context_correction_job_v3(uuid, date, uuid) TO service_role;
