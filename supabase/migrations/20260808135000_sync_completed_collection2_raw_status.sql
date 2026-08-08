-- P0 recovery safety: keep the raw terminal marker consistent with the
-- canonical completed collection_2 job without recollecting messages.

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_completed_collection_2_raw_status_v3()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.job_type = 'collection_2' AND NEW.status = 'completed' THEN
    UPDATE public.raw_daily_conversations_v3
    SET collection_2_status = 'completed',
        collection_2_cutoff = COALESCE(collection_2_cutoff, NEW.cutoff_at),
        updated_at = now()
    WHERE child_id = NEW.child_id
      AND business_date = NEW.business_date
      AND collection_2_status <> 'completed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_completed_collection_2_raw_status_v3
  ON public.pipeline_jobs;
CREATE TRIGGER trg_sync_completed_collection_2_raw_status_v3
AFTER INSERT OR UPDATE OF status ON public.pipeline_jobs
FOR EACH ROW
EXECUTE FUNCTION public.sync_completed_collection_2_raw_status_v3();

UPDATE public.raw_daily_conversations_v3 r
SET collection_2_status = 'completed',
    collection_2_cutoff = COALESCE(r.collection_2_cutoff, p.cutoff_at),
    updated_at = now()
FROM public.pipeline_jobs p
WHERE p.child_id = r.child_id
  AND p.business_date = r.business_date
  AND p.job_type = 'collection_2'
  AND p.status = 'completed'
  AND r.collection_2_status <> 'completed';

REVOKE ALL ON FUNCTION public.sync_completed_collection_2_raw_status_v3()
  FROM PUBLIC, anon, authenticated;

COMMIT;
