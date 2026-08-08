-- P0: collection_2 completed(0)도 Correction/Memory/Report가 모두 terminal 상태를
-- 가지도록 한다. 실제 대화가 없으므로 LLM은 호출하지 않고 NO_CONVERSATION으로
-- 완료하며, 기존 completed 작업은 재처리하지 않는다.

BEGIN;

CREATE OR REPLACE FUNCTION public.complete_context_correction_job_v3_no_conversation(
  p_job_id uuid,
  p_claimed_by text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_job public.pipeline_jobs%ROWTYPE;
  v_stage public.job_type_enum;
  v_stage_job_id uuid;
BEGIN
  SELECT * INTO v_job
  FROM public.pipeline_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_NOT_FOUND'; END IF;
  IF v_job.status != 'processing' OR v_job.claimed_by != p_claimed_by THEN
    RAISE EXCEPTION 'JOB_NOT_CLAIMED_BY_WORKER';
  END IF;
  IF v_job.claim_expires_at < now() THEN RAISE EXCEPTION 'LEASE_EXPIRED'; END IF;

  UPDATE public.pipeline_jobs
  SET status = 'completed',
      completed_at = now(),
      last_error_code = NULL,
      last_error_summary = 'NO_CONVERSATION',
      updated_at = now()
  WHERE id = p_job_id;

  UPDATE public.pipeline_execution_items
  SET status = 'completed',
      outcome = 'NO_CONVERSATION',
      completed_at = now(),
      updated_at = now()
  WHERE job_id = p_job_id AND status NOT IN ('completed', 'failed');

  FOREACH v_stage IN ARRAY ARRAY[
    'memory_batch'::public.job_type_enum,
    'daily_report'::public.job_type_enum
  ]
  LOOP
    SELECT id INTO v_stage_job_id
    FROM public.pipeline_jobs
    WHERE child_id = v_job.child_id
      AND business_date = v_job.business_date
      AND job_type = v_stage
      AND generation_version = 1
    LIMIT 1
    FOR UPDATE;

    IF v_stage_job_id IS NULL THEN
      INSERT INTO public.pipeline_jobs (
        job_type, child_id, business_date, execution_id, status,
        attempt_count, max_attempts, completed_at, idempotency_key,
        generation_version, last_error_summary, created_at, updated_at
      ) VALUES (
        v_stage, v_job.child_id, v_job.business_date, v_job.execution_id, 'completed',
        0, 3, now(), concat(v_stage::text, '_', v_job.child_id::text, '_', v_job.business_date::text),
        1, 'NO_CONVERSATION', now(), now()
      )
      RETURNING id INTO v_stage_job_id;
    ELSE
      UPDATE public.pipeline_jobs
      SET status = 'completed',
          completed_at = COALESCE(completed_at, now()),
          claimed_by = NULL,
          claimed_at = NULL,
          claim_expires_at = NULL,
          last_error_code = NULL,
          last_error_summary = 'NO_CONVERSATION',
          updated_at = now()
      WHERE id = v_stage_job_id AND status <> 'completed';
    END IF;

    INSERT INTO public.pipeline_execution_items (
      execution_id, job_id, child_id, business_date, job_type,
      status, outcome, item_key, completed_at, updated_at
    ) VALUES (
      v_job.execution_id, v_stage_job_id, v_job.child_id, v_job.business_date, v_stage,
      'completed', 'NO_CONVERSATION', v_stage::text, now(), now()
    )
    ON CONFLICT (execution_id, child_id, item_key) DO UPDATE SET
      job_id = EXCLUDED.job_id,
      status = 'completed',
      outcome = 'NO_CONVERSATION',
      completed_at = COALESCE(pipeline_execution_items.completed_at, now()),
      updated_at = now()
    WHERE pipeline_execution_items.status NOT IN ('completed', 'failed');
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_context_correction_job_v3_no_conversation(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_context_correction_job_v3_no_conversation(uuid, text)
  TO service_role;

COMMIT;
