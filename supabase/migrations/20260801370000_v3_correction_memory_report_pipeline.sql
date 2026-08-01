-- 20260801370000_v3_correction_memory_report_pipeline.sql
-- Unified V3 Pipeline Migration for Correction, Memory Batch, and Daily Report

-- 0. Pipeline Execution Jobs Junction Table for Immutable Execution Result Tracking
CREATE TABLE IF NOT EXISTS public.pipeline_execution_jobs (
  execution_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.pipeline_jobs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (execution_id, job_id)
);

ALTER TABLE public.pipeline_execution_jobs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.pipeline_execution_jobs TO service_role;

-- 1. Helper: Enqueue Pipeline Job V3
CREATE OR REPLACE FUNCTION public.enqueue_pipeline_job_v3(
    p_job_type text,
    p_child_id uuid,
    p_business_date date,
    p_execution_id uuid,
    p_idempotency_key text,
    p_collection_phase integer DEFAULT NULL,
    p_cutoff_at timestamptz DEFAULT NULL,
    p_priority integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_is_enabled boolean;
  v_typed_job_type public.job_type_enum;
  v_existing_id uuid;
  v_existing_status text;
  v_target_job_id uuid;
BEGIN
  SELECT enabled INTO v_is_enabled FROM public.pipeline_v3_control WHERE id = 1;
  IF NOT COALESCE(v_is_enabled, false) THEN
    RAISE EXCEPTION 'V3_DISABLED';
  END IF;

  v_typed_job_type := p_job_type::public.job_type_enum;

  SELECT id, status INTO v_existing_id, v_existing_status
  FROM public.pipeline_jobs
  WHERE job_type = v_typed_job_type AND child_id = p_child_id AND business_date = p_business_date
  FOR UPDATE;

  IF v_existing_id IS NULL THEN
    SELECT id, status INTO v_existing_id, v_existing_status
    FROM public.pipeline_jobs
    WHERE idempotency_key = p_idempotency_key
    FOR UPDATE;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    v_target_job_id := v_existing_id;
    IF v_existing_status = 'completed' THEN
      UPDATE public.pipeline_jobs
      SET execution_id = p_execution_id,
          last_error_summary = 'SKIPPED',
          updated_at = now()
      WHERE id = v_existing_id;

      IF v_typed_job_type = 'memory_batch'::public.job_type_enum THEN
        PERFORM public.enqueue_daily_report_job_v3(p_child_id, p_business_date, p_execution_id);
      END IF;
    ELSIF v_existing_status = 'failed' THEN
      UPDATE public.pipeline_jobs
      SET status = 'pending',
          attempt_count = 0,
          execution_id = p_execution_id,
          last_error_code = NULL,
          last_error_summary = NULL,
          claimed_by = NULL,
          claimed_at = NULL,
          claim_expires_at = NULL,
          started_at = NULL,
          completed_at = NULL,
          next_retry_at = NULL,
          updated_at = now()
      WHERE id = v_existing_id;
    ELSE
      UPDATE public.pipeline_jobs
      SET execution_id = p_execution_id,
          updated_at = now()
      WHERE id = v_existing_id;
    END IF;
  ELSE
    v_target_job_id := gen_random_uuid();
    INSERT INTO public.pipeline_jobs (
      id, job_type, child_id, business_date, collection_phase, cutoff_at,
      execution_id, status, attempt_count, priority, idempotency_key, created_at, updated_at
    ) VALUES (
      v_target_job_id, v_typed_job_type, p_child_id, p_business_date, p_collection_phase, p_cutoff_at,
      p_execution_id, 'pending', 0, p_priority, p_idempotency_key, now(), now()
    );
  END IF;

  IF p_execution_id IS NOT NULL AND v_target_job_id IS NOT NULL THEN
    INSERT INTO public.pipeline_execution_jobs (execution_id, job_id)
    VALUES (p_execution_id, v_target_job_id)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$function$;

-- 2. Memory batch enqueue RPC
CREATE OR REPLACE FUNCTION public.enqueue_memory_batch_job_v3(
    p_child_id uuid,
    p_business_date date,
    p_execution_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public.enqueue_pipeline_job_v3(
    'memory_batch',
    p_child_id,
    p_business_date,
    p_execution_id,
    'memory_batch_' || p_child_id::text || '_' || p_business_date::text,
    NULL,
    NULL,
    2
  );
END;
$function$;

-- 3. Update enqueue_daily_report_job_v3 to use enqueue_pipeline_job_v3
CREATE OR REPLACE FUNCTION public.enqueue_daily_report_job_v3(
    p_child_id uuid,
    p_business_date date,
    p_execution_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public.enqueue_pipeline_job_v3(
    'daily_report',
    p_child_id,
    p_business_date,
    p_execution_id,
    'daily_report_' || p_child_id::text || '_' || p_business_date::text,
    NULL,
    NULL,
    2
  );
END;
$function$;

-- 4. Claim memory batch jobs RPC
CREATE OR REPLACE FUNCTION public.claim_memory_batch_jobs_v3(
    p_claimed_by text,
    p_limit integer
)
RETURNS SETOF public.pipeline_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'INVALID_LIMIT';
  END IF;

  RETURN QUERY
  WITH available AS (
    SELECT j_mem.id
    FROM public.pipeline_jobs j_mem
    WHERE j_mem.job_type = 'memory_batch'
      AND (j_mem.status = 'pending' OR (j_mem.status = 'retry_wait' AND j_mem.next_retry_at <= now()) OR (j_mem.status = 'processing' AND j_mem.claim_expires_at <= now()))
      AND j_mem.attempt_count < j_mem.max_attempts
    ORDER BY j_mem.created_at ASC
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

-- 5. Complete memory batch job RPC (atomically triggers daily_report)
CREATE OR REPLACE FUNCTION public.complete_memory_batch_job_v3(
    p_job_id uuid,
    p_claimed_by text,
    p_summary_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_job public.pipeline_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job
  FROM public.pipeline_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;

  IF v_job.status != 'processing' OR v_job.claimed_by != p_claimed_by THEN
    RAISE EXCEPTION 'JOB_NOT_CLAIMED_BY_WORKER';
  END IF;

  UPDATE public.pipeline_jobs
  SET status = 'completed',
      last_error_summary = p_summary_note,
      completed_at = now(),
      updated_at = now()
  WHERE id = p_job_id;

  -- Trigger daily report ONLY when Memory completes/skips
  IF v_job.execution_id IS NOT NULL THEN
    PERFORM public.enqueue_daily_report_job_v3(v_job.child_id, v_job.business_date, v_job.execution_id);
  END IF;
END;
$function$;

-- 6. Fail memory batch job RPC (terminal failure -> enqueues daily_report immediately)
CREATE OR REPLACE FUNCTION public.fail_memory_batch_job_v3(
    p_job_id uuid,
    p_claimed_by text,
    p_error_code text,
    p_error_summary text,
    p_retryable boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_job public.pipeline_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job
  FROM public.pipeline_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;

  IF v_job.status != 'processing' OR v_job.claimed_by != p_claimed_by THEN
    RAISE EXCEPTION 'JOB_NOT_CLAIMED_BY_WORKER';
  END IF;

  -- Memory attempt failure is recorded as terminal failed immediately
  -- so Daily Report is NEVER delayed or blocked. Admin rerun resets failed Memory to pending.
  UPDATE public.pipeline_jobs
  SET status = 'failed',
      last_error_code = p_error_code,
      last_error_summary = p_error_summary,
      completed_at = now(),
      updated_at = now()
  WHERE id = p_job_id;

  -- Trigger daily report unconditionally when Memory fails so Report is not permanently blocked
  PERFORM public.enqueue_daily_report_job_v3(v_job.child_id, v_job.business_date, v_job.execution_id);
END;
$function$;

-- 7. Update claim_daily_report_jobs_v3 to refuse jobs while a same child/date/execution Memory job is nonterminal
CREATE OR REPLACE FUNCTION public.claim_daily_report_jobs_v3(p_claimed_by text, p_limit integer)
RETURNS SETOF public.pipeline_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'INVALID_LIMIT';
  END IF;

  RETURN QUERY
  WITH available AS (
    SELECT j_report.id
    FROM public.pipeline_jobs j_report
    WHERE j_report.job_type = 'daily_report'
      AND (j_report.status = 'pending' OR (j_report.status = 'retry_wait' AND j_report.next_retry_at <= now()) OR (j_report.status = 'processing' AND j_report.claim_expires_at <= now()))
      AND j_report.attempt_count < j_report.max_attempts
      AND NOT EXISTS (
        SELECT 1
        FROM public.pipeline_jobs j_mem
        WHERE j_mem.job_type = 'memory_batch'
          AND j_mem.child_id = j_report.child_id
          AND j_mem.business_date = j_report.business_date
          AND j_mem.execution_id IS NOT DISTINCT FROM j_report.execution_id
          AND j_mem.status IN ('pending', 'processing', 'retry_wait')
      )
    ORDER BY j_report.created_at ASC
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

-- 8. Complete daily report job RPC (accepts p_summary_note text DEFAULT NULL)
DROP FUNCTION IF EXISTS public.complete_daily_report_job_v3(uuid, text, uuid, date, uuid);
DROP FUNCTION IF EXISTS public.complete_daily_report_job_v3(uuid, text, uuid, date, uuid, text);

CREATE OR REPLACE FUNCTION public.complete_daily_report_job_v3(
    p_job_id uuid,
    p_claimed_by text,
    p_child_id uuid,
    p_business_date date,
    p_report_id uuid,
    p_summary_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_job_status text;
  v_job_claimed_by text;
BEGIN
  SELECT status, claimed_by INTO v_job_status, v_job_claimed_by
  FROM public.pipeline_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF v_job_status IS NULL THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;
  
  IF v_job_status != 'processing' OR v_job_claimed_by != p_claimed_by THEN
    RAISE EXCEPTION 'JOB_NOT_CLAIMED_BY_WORKER';
  END IF;

  UPDATE public.corrected_daily_conversations_v3
  SET report_generated_at = now()
  WHERE child_id = p_child_id AND business_date = p_business_date AND correction_status = 'completed';

  UPDATE public.pipeline_jobs
  SET status = 'completed',
      last_error_summary = p_summary_note,
      completed_at = now(),
      updated_at = now()
  WHERE id = p_job_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_pipeline_job_v3(text, uuid, date, uuid, text, integer, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_pipeline_job_v3(text, uuid, date, uuid, text, integer, timestamptz, integer) TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_memory_batch_job_v3(uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_memory_batch_job_v3(uuid, date, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_daily_report_job_v3(uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_daily_report_job_v3(uuid, date, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.claim_memory_batch_jobs_v3(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_memory_batch_jobs_v3(text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.complete_memory_batch_job_v3(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_memory_batch_job_v3(uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.fail_memory_batch_job_v3(uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_memory_batch_job_v3(uuid, text, text, text, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.claim_daily_report_jobs_v3(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_report_jobs_v3(text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.complete_daily_report_job_v3(uuid, text, uuid, date, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_daily_report_job_v3(uuid, text, uuid, date, uuid, text) TO service_role;
