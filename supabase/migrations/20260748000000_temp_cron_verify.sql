CREATE OR REPLACE FUNCTION public.debug_list_cron_jobs()
RETURNS TABLE(jobid bigint, jobname text, schedule text, active boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, cron, pg_temp
AS $$
  SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;
$$;
REVOKE EXECUTE ON FUNCTION public.debug_list_cron_jobs FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debug_list_cron_jobs TO service_role;
