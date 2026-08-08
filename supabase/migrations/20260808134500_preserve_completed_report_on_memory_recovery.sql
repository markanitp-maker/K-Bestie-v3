-- P0 recovery safety: a recovered memory job must not regenerate an already
-- completed daily report. Link the execution as ALREADY_COMPLETED instead.

BEGIN;

CREATE OR REPLACE FUNCTION public.complete_memory_batch_job_v3(
  p_job_id uuid,
  p_claimed_by text,
  p_summary_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.pipeline_jobs%ROWTYPE;
  v_exec_rec record;
  v_report_job_id uuid;
BEGIN
  SELECT * INTO v_job FROM public.pipeline_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_NOT_FOUND'; END IF;
  IF v_job.status != 'processing' OR v_job.claimed_by != p_claimed_by THEN
    RAISE EXCEPTION 'JOB_NOT_CLAIMED_BY_WORKER';
  END IF;
  IF v_job.claim_expires_at < now() THEN RAISE EXCEPTION 'LEASE_EXPIRED'; END IF;

  UPDATE public.pipeline_jobs
  SET status = 'completed',
      last_error_summary = p_summary_note,
      completed_at = now(),
      updated_at = now()
  WHERE id = p_job_id;

  FOR v_exec_rec IN
    WITH updated AS (
      UPDATE public.pipeline_execution_items
      SET status = 'completed',
          outcome = COALESCE(p_summary_note, 'SUCCESS'),
          completed_at = now(),
          updated_at = now()
      WHERE job_id = p_job_id AND status NOT IN ('completed', 'failed')
      RETURNING execution_id
    )
    SELECT DISTINCT execution_id FROM updated
  LOOP
    SELECT id INTO v_report_job_id
    FROM public.pipeline_jobs
    WHERE child_id = v_job.child_id
      AND business_date = v_job.business_date
      AND job_type = 'daily_report'
      AND status = 'completed'
    LIMIT 1;

    IF v_report_job_id IS NOT NULL THEN
      INSERT INTO public.pipeline_execution_items (
        execution_id, job_id, child_id, business_date, job_type,
        status, outcome, item_key, completed_at, updated_at
      ) VALUES (
        v_exec_rec.execution_id, v_report_job_id, v_job.child_id, v_job.business_date, 'daily_report',
        'completed', 'ALREADY_COMPLETED', 'daily_report', now(), now()
      )
      ON CONFLICT (execution_id, child_id, item_key) DO UPDATE SET
        job_id = EXCLUDED.job_id,
        status = 'completed',
        outcome = 'ALREADY_COMPLETED',
        completed_at = COALESCE(pipeline_execution_items.completed_at, now()),
        updated_at = now()
      WHERE pipeline_execution_items.status NOT IN ('completed', 'failed');
    ELSE
      PERFORM public.enqueue_daily_report_job_v3(v_job.child_id, v_job.business_date, v_exec_rec.execution_id);
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_memory_batch_job_v3(uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_memory_batch_job_v3(uuid,text,text)
  TO service_role;

COMMIT;
