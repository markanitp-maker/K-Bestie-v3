BEGIN;

CREATE OR REPLACE FUNCTION public.claim_pipeline_jobs(
  p_claimed_by text,
  p_limit integer
)
RETURNS SETOF public.pipeline_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'INVALID_LIMIT';
  END IF;

  RETURN QUERY
  WITH available AS (
    SELECT id
    FROM public.pipeline_jobs
    WHERE (status = 'pending' OR (status = 'retry_wait' AND next_retry_at <= now()) OR (status = 'processing' AND claim_expires_at <= now()))
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
$$;
REVOKE EXECUTE ON FUNCTION public.claim_pipeline_jobs(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pipeline_jobs(text, integer) TO service_role;

COMMIT;
