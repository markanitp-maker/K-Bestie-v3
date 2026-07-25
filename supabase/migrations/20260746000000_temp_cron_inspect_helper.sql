-- 임시 진단용 함수 — pg_cron 스케줄 상태를 service_role이 supabase-js로 조회하기 위함.
-- 조회 완료 후 즉시 DROP하는 후속 마이그레이션(20260747000000)으로 제거된다.
CREATE OR REPLACE FUNCTION public.debug_list_cron_jobs()
RETURNS TABLE(jobid bigint, jobname text, schedule text, command text, active boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, cron, pg_temp
AS $$
  SELECT jobid, jobname, schedule, command, active FROM cron.job ORDER BY jobid;
$$;

REVOKE EXECUTE ON FUNCTION public.debug_list_cron_jobs FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debug_list_cron_jobs TO service_role;
