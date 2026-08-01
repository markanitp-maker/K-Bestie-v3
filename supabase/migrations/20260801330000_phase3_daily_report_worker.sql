-- Migration: 20260801270000_phase3_daily_report_worker.sql

CREATE OR REPLACE FUNCTION public.enqueue_daily_report_job_v3(
    p_child_id uuid,
    p_business_date date,
    p_execution_id uuid
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_enabled boolean;
BEGIN
  -- 1. V3 파이프라인 활성화 확인
  SELECT enabled INTO v_is_enabled
  FROM public.pipeline_v3_control
  WHERE id = 1;

  IF NOT COALESCE(v_is_enabled, false) THEN
    RAISE EXCEPTION 'V3_DISABLED';
  END IF;

  -- 2. 이미 존재하는 pending/processing/completed 잡이 있는지 확인 (멱등성)
  IF EXISTS (
    SELECT 1 
    FROM public.pipeline_jobs 
    WHERE job_type = 'daily_report'
      AND child_id = p_child_id 
      AND business_date = p_business_date 
      AND status IN ('pending', 'processing', 'retry_wait', 'completed')
  ) THEN
    RETURN;
  END IF;

  -- 3. 새로운 잡 생성 (idempotency_key = daily_report + child_id + date)
  INSERT INTO public.pipeline_jobs (
    id,
    job_type,
    child_id,
    business_date,
    execution_id,
    status,
    attempt_count,
    priority,
    idempotency_key
  ) VALUES (
    gen_random_uuid(),
    'daily_report',
    p_child_id,
    p_business_date,
    p_execution_id,
    'pending',
    0,
    2,
    'daily_report_' || p_child_id::text || '_' || p_business_date::text
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_daily_report_jobs_v3(p_claimed_by text, p_limit integer)
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
    WHERE job_type = 'daily_report'
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

CREATE OR REPLACE FUNCTION public.complete_daily_report_job_v3(
    p_job_id uuid,
    p_claimed_by text,
    p_child_id uuid,
    p_business_date date,
    p_report_id uuid
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job_status text;
  v_job_claimed_by text;
BEGIN
  -- 1. Job 상태 확인 및 락
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

  -- 2. corrected_daily_conversations_v3 에 report_generated_at 업데이트
  UPDATE public.corrected_daily_conversations_v3
  SET report_generated_at = now()
  WHERE child_id = p_child_id AND business_date = p_business_date AND correction_status = 'completed';

  -- 3. Job 상태 완료 처리
  UPDATE public.pipeline_jobs
  SET status = 'completed',
      completed_at = now(),
      updated_at = now()
  WHERE id = p_job_id;
END;
$function$;


REVOKE EXECUTE ON FUNCTION public.enqueue_daily_report_job_v3(uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_daily_report_job_v3(uuid, date, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.claim_daily_report_jobs_v3(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_report_jobs_v3(text, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.complete_daily_report_job_v3(uuid, text, uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_daily_report_job_v3(uuid, text, uuid, date, uuid) TO service_role;
