BEGIN;
DROP FUNCTION public.claim_pipeline_jobs(p_job_type job_type_enum, p_limit integer, p_claimed_by text, p_lease_minutes integer);
COMMIT;
