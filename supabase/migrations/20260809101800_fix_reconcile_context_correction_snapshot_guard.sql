-- 071 Target QA(2026-08-09) 중 실측 발견: enqueue_context_correction_job_v3의 실제 DB
-- 라이브 정의(로컬 마이그레이션 파일에는 없던 out-of-band 변경분, pg_get_functiondef로
-- 직접 확인)에 아래 가드가 있었다.
--
--   IF NOT EXISTS (
--     SELECT 1 FROM pipeline_execution_items
--     WHERE execution_id = p_execution_id AND child_id = p_child_id
--       AND business_date = p_business_date AND job_type = 'context_correction'
--       AND status NOT IN ('completed', 'failed')
--   ) THEN
--     RETURN NULL;
--   END IF;
--
-- 이 가드는 "pipeline_execution_items에 스냅샷 행이 미리 있어야만 동작"을 강제한다.
-- app/api/admin/reporting/run/route.ts(관리자 수동 실행)는 enqueue 전에 스냅샷을
-- upsert하므로 이 가드를 우연히 통과하지만, reconcile_pipeline_v3(자기치유 로직,
-- 이번 071이 10분/일 단위로 자동 호출하는 핵심 경로)는 스냅샷 없이 바로 이 함수를
-- 호출해 매번 조용히 NULL을 반환한다 — Correction/Memory/Report가 영원히 자동
-- 생성되지 않는 근본 원인. 실측: Dev에서 새 워커(app/api/batch/v3/worker)로
-- collection_1→collection_2까지는 실제 claim+completed까지 확인했지만, 그 이후
-- context_correction은 pipeline_jobs에 행조차 생성되지 않음을 raw SQL 대조로 확인.
--
-- 수정: "스냅샷이 없으면 포기"가 아니라 "스냅샷이 없으면 만들고 계속 진행"으로 바꾼다.
-- 이미 스냅샷이 있는 admin 경로는 ON CONFLICT DO NOTHING이라 동작이 그대로 유지되고,
-- reconcile처럼 스냅샷 없이 호출하는 경로는 이제 즉시 자기 스냅샷을 만들고 계속
-- 진행해 실제로 enqueue_pipeline_job_v3까지 도달한다.
--
-- enqueue_memory_batch_job_v3 / enqueue_daily_report_job_v3는 대조 확인 결과 이런
-- 가드가 없는 단순 wrapper라 이 버그의 영향을 받지 않는다(수정 대상 아님).

CREATE OR REPLACE FUNCTION public.enqueue_context_correction_job_v3(
  p_child_id uuid,
  p_business_date date,
  p_execution_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_raw_id uuid;
  v_corr_id uuid;
  v_raw_set uuid[];
  v_corr_set uuid[];
  v_job_id uuid;
BEGIN
  SELECT id INTO v_raw_id
  FROM public.raw_daily_conversations_v3
  WHERE child_id = p_child_id AND business_date = p_business_date;

  SELECT id INTO v_corr_id
  FROM public.corrected_daily_conversations_v3
  WHERE child_id = p_child_id AND business_date = p_business_date
    AND (correction_status = 'completed' OR status = 'completed');

  -- 호출부가 스냅샷을 미리 안 만들었으면(reconcile 자기치유 경로) 여기서 만든다.
  -- 이미 있으면(admin 수동 실행 경로) 그대로 둔다(DO NOTHING) — 기존 admin 경로 동작 불변.
  INSERT INTO public.pipeline_execution_items (
    execution_id, child_id, business_date, job_type, status, item_key, updated_at
  ) VALUES (
    p_execution_id, p_child_id, p_business_date, 'context_correction', 'pending', 'context_correction', now()
  ) ON CONFLICT (execution_id, child_id, item_key) DO NOTHING;

  IF v_raw_id IS NOT NULL THEN
    SELECT array_agg(source_message_id ORDER BY source_message_id) INTO v_raw_set
    FROM public.raw_daily_conversation_messages_v3
    WHERE raw_daily_conversation_v3_id = v_raw_id;
  END IF;

  IF v_corr_id IS NOT NULL THEN
    SELECT array_agg(source_message_id ORDER BY source_message_id) INTO v_corr_set
    FROM public.corrected_daily_conversation_messages_v3
    WHERE corrected_daily_conversation_id = v_corr_id;
  END IF;

  IF v_corr_id IS NOT NULL AND v_raw_set IS NOT NULL THEN
    IF v_raw_set = v_corr_set THEN
      INSERT INTO public.pipeline_execution_items (
        execution_id, child_id, business_date, job_type, status, outcome, item_key, completed_at, updated_at
      ) VALUES (
        p_execution_id, p_child_id, p_business_date, 'context_correction', 'completed', 'ALREADY_COMPLETED', 'context_correction', now(), now()
      ) ON CONFLICT (execution_id, child_id, item_key) DO UPDATE SET
        status = 'completed',
        outcome = 'ALREADY_COMPLETED',
        completed_at = COALESCE(pipeline_execution_items.completed_at, now()),
        updated_at = now()
      WHERE pipeline_execution_items.status NOT IN ('completed', 'failed');

      PERFORM public.enqueue_memory_batch_job_v3(p_child_id, p_business_date, p_execution_id);
      RETURN NULL;
    ELSE
      UPDATE public.pipeline_jobs
      SET status = 'pending',
          attempt_count = 0,
          claimed_by = NULL,
          claimed_at = NULL,
          claim_expires_at = NULL,
          started_at = NULL,
          completed_at = NULL,
          next_retry_at = now(),
          last_error_code = NULL,
          last_error_summary = NULL,
          updated_at = now()
      WHERE child_id = p_child_id AND business_date = p_business_date
        AND job_type IN ('context_correction'::public.job_type_enum, 'memory_batch'::public.job_type_enum, 'daily_report'::public.job_type_enum);

      UPDATE public.pipeline_execution_items
      SET status = 'pending',
          outcome = NULL,
          error_code = NULL,
          error_summary = NULL,
          updated_at = now()
      WHERE execution_id = p_execution_id
        AND child_id = p_child_id
        AND business_date = p_business_date
        AND job_type IN ('context_correction', 'memory_batch', 'daily_report')
        AND status NOT IN ('completed', 'failed');
    END IF;
  END IF;

  v_job_id := public.enqueue_pipeline_job_v3('context_correction', p_child_id, p_business_date, p_execution_id);
  RETURN v_job_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_context_correction_job_v3(uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_context_correction_job_v3(uuid, date, uuid) TO service_role;
