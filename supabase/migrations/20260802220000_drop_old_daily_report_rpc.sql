BEGIN;

DROP FUNCTION IF EXISTS public.save_and_complete_daily_report_job_v3(uuid, text, uuid, date, jsonb);
DROP FUNCTION IF EXISTS public.save_and_complete_daily_report_job_v3(uuid, text, uuid, date, jsonb, text, timestamptz);

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';

COMMIT;
