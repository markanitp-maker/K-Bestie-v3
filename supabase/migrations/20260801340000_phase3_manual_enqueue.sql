-- Migration: 20260801340000_phase3_manual_enqueue.sql
-- Description: RPCs for manual enqueue via Admin UI

CREATE OR REPLACE FUNCTION public.enqueue_manual_collection_job_v3(
    p_child_id uuid,
    p_business_date date,
    p_phase integer,
    p_cutoff timestamptz,
    p_execution_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_enabled boolean;
  v_idempotency_key text;
BEGIN
  -- 1. V3 파이프라인 활성화 확인
  SELECT enabled INTO v_is_enabled
  FROM public.pipeline_v3_control
  WHERE id = 1;

  IF NOT COALESCE(v_is_enabled, false) THEN
    RAISE EXCEPTION 'V3_DISABLED';
  END IF;

  -- 2. Phase 검증
  IF p_phase NOT IN (1, 2) THEN
    RAISE EXCEPTION 'INVALID_PHASE';
  END IF;

  v_idempotency_key := 'collection_manual_' || p_child_id::text || '_' || p_business_date::text || '_' || p_phase::text || '_' || extract(epoch from p_cutoff)::text;

  -- 3. 새로운 잡 생성 (idempotency_key 기준)
  INSERT INTO public.pipeline_jobs (
    id,
    job_type,
    child_id,
    business_date,
    collection_phase,
    cutoff_at,
    execution_id,
    status,
    attempt_count,
    priority,
    idempotency_key
  ) VALUES (
    gen_random_uuid(),
    ('collection_' || p_phase::text)::public.job_type_enum,
    p_child_id,
    p_business_date,
    p_phase,
    p_cutoff,
    p_execution_id,
    'pending',
    0,
    1,
    v_idempotency_key
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enqueue_manual_collection_job_v3(uuid, date, integer, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_manual_collection_job_v3(uuid, date, integer, timestamptz, uuid) TO service_role;
