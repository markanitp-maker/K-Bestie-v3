-- Phase 2 finalization fix (2026-08-07)
--
-- 확정 원인: enqueue_collection_jobs_v3의 Phase 2 candidate 선정이
-- chat_messages.collected_at IS NULL 기반이므로, Phase 1에서 당일 대화가
-- 모두 수집된 뒤 Phase 2 신규 메시지가 0건인 아이는 collection_2 Job 자체가
-- 미생성되어 Context Correction → Memory Batch → Daily Report가 영구 누락된다.
-- (실측: 안서현 2026-08-06 — Phase1 30건 수집 완료, Phase2 미션 세션 메시지 0건
--  → Phase 2 Cron 정상 실행됐으나 candidate 없음 → Report 미생성 확정)
--
-- 확정 정책: Phase 2 = child_id+business_date의 하루 마감(finalization) 단계.
-- collection_1이 completed인 아이는 Phase 2 신규 메시지가 0건이어도
-- collection_2 Job을 생성한다. Worker는 0건이면 finalization(JSONB 재스냅샷 +
-- collection_2_status='completed')만 수행하고 downstream을 1회 enqueue한다.
-- (collect_chat_messages_v3는 이미 0건 처리가 올바르게 구현됨 — 수정 불필요)
--
-- Phase 1 candidate 쿼리(uncollected IS NULL)는 변경하지 않는다.
-- 중복 Job 방지: NOT EXISTS + idempotency_key UNIQUE 이중 방어 유지.

CREATE OR REPLACE FUNCTION public.enqueue_collection_jobs_v3(
  p_collection_phase integer,
  p_business_date date,
  p_execution_id uuid,
  p_child_id uuid DEFAULT NULL,
  p_cutoff_at timestamptz DEFAULT NULL,
  p_include_downstream boolean DEFAULT false,
  p_use_current_time boolean DEFAULT false
)
RETURNS TABLE (
  out_execution_id uuid,
  cutoff_at timestamptz,
  enqueued_count integer,
  existing_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_v3_enabled boolean;
  v_job_type text;
  v_cutoff timestamptz;
  v_sched_start timestamptz;
  v_sched_end timestamptz;
  v_target RECORD;
  v_enqueued integer := 0;
  v_existing integer := 0;
BEGIN
  SELECT enabled INTO v_v3_enabled FROM public.pipeline_v3_control WHERE id = 1;
  IF v_v3_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'V3_DISABLED';
  END IF;

  IF p_collection_phase NOT IN (1, 2) THEN
    RAISE EXCEPTION 'INVALID_PHASE';
  END IF;

  v_job_type := CASE WHEN p_collection_phase = 1 THEN 'collection_1' ELSE 'collection_2' END;

  IF p_collection_phase = 1 THEN
    v_sched_start := (p_business_date::text || ' 00:00:00+09')::timestamptz;
    v_sched_end := (p_business_date::text || ' 17:55:00+09')::timestamptz;
  ELSE
    v_sched_start := (p_business_date::text || ' 00:00:00+09')::timestamptz;
    v_sched_end := ((p_business_date + 1)::text || ' 00:00:00+09')::timestamptz;
  END IF;

  IF p_use_current_time THEN
    v_cutoff := LEAST(GREATEST(now(), v_sched_start), v_sched_end);
  ELSIF p_cutoff_at IS NOT NULL THEN
    IF p_cutoff_at >= v_sched_start AND p_cutoff_at <= v_sched_end AND p_cutoff_at <= now() THEN
      v_cutoff := p_cutoff_at;
    ELSE
      RAISE EXCEPTION 'INVALID_CUTOFF';
    END IF;
  ELSE
    v_cutoff := v_sched_end;
  END IF;

  IF p_child_id IS NOT NULL THEN
    -- 단일 아이 지정 처리 (관리자 수동 실행 등)
    IF NOT EXISTS (SELECT 1 FROM public.child_profiles WHERE id = p_child_id) THEN
      RAISE EXCEPTION 'CHILD_NOT_FOUND';
    END IF;
    IF p_include_downstream AND p_collection_phase = 2 THEN
      INSERT INTO public.pipeline_execution_items (execution_id, child_id, business_date, job_type, status, item_key, updated_at)
      VALUES
        (p_execution_id, p_child_id, p_business_date, 'context_correction', 'pending', 'context_correction', now()),
        (p_execution_id, p_child_id, p_business_date, 'memory_batch', 'pending', 'memory_batch', now()),
        (p_execution_id, p_child_id, p_business_date, 'daily_report', 'pending', 'daily_report', now())
      ON CONFLICT (execution_id, child_id, item_key) DO UPDATE SET
        status = CASE WHEN pipeline_execution_items.status IN ('completed', 'failed') THEN pipeline_execution_items.status ELSE 'pending' END,
        updated_at = now()
      WHERE pipeline_execution_items.status NOT IN ('completed', 'failed');
    END IF;
    PERFORM public.enqueue_pipeline_job_v3(v_job_type, p_child_id, p_business_date, p_execution_id, p_collection_phase, v_cutoff);

    v_enqueued := 1;
  ELSE
    -- 전체 아이 일괄 처리 (Cron 자동 실행)
    IF p_collection_phase = 1 THEN
      -- Phase 1: 기존 uncollected 메시지 기반 candidate 선정 (변경 없음)
      FOR v_target IN
        SELECT DISTINCT s.child_id
        FROM public.chat_messages m
        JOIN public.chat_sessions s ON m.session_id = s.id
        WHERE m.created_at >= v_sched_start
          AND m.created_at < v_cutoff
          AND m.collected_at IS NULL
          AND (
            (s.session_type = 'mission' AND s.mission_phase = 1)
            OR
            (s.session_type != 'mission')
          )
      LOOP
        PERFORM public.enqueue_pipeline_job_v3(v_job_type, v_target.child_id, p_business_date, p_execution_id, p_collection_phase, v_cutoff);
        v_enqueued := v_enqueued + 1;
      END LOOP;
    ELSE
      -- Phase 2 (수정): collection_1 completed 기반 candidate 선정.
      -- 신규 uncollected 메시지 유무와 무관하게 Phase 1이 완료된 아이 전원을 대상으로 한다.
      -- Phase 2 = 하루 마감(finalization) 단계이므로 0건 신규 메시지도 정상 처리한다.
      -- NOT EXISTS 조건으로 이미 collection_2 Job이 있는 아이는 제외(중복 방지).
      FOR v_target IN
        SELECT DISTINCT pj.child_id
        FROM public.pipeline_jobs pj
        WHERE pj.business_date = p_business_date
          AND pj.job_type = 'collection_1'
          AND pj.status = 'completed'
          AND NOT EXISTS (
            SELECT 1
            FROM public.pipeline_jobs ex
            WHERE ex.child_id = pj.child_id
              AND ex.business_date = p_business_date
              AND ex.job_type = 'collection_2'
          )
      LOOP
        IF p_include_downstream THEN
          INSERT INTO public.pipeline_execution_items (execution_id, child_id, business_date, job_type, status, item_key, updated_at)
          VALUES
            (p_execution_id, v_target.child_id, p_business_date, 'context_correction', 'pending', 'context_correction', now()),
            (p_execution_id, v_target.child_id, p_business_date, 'memory_batch', 'pending', 'memory_batch', now()),
            (p_execution_id, v_target.child_id, p_business_date, 'daily_report', 'pending', 'daily_report', now())
          ON CONFLICT (execution_id, child_id, item_key) DO UPDATE SET
            status = CASE WHEN pipeline_execution_items.status IN ('completed', 'failed') THEN pipeline_execution_items.status ELSE 'pending' END,
            updated_at = now()
          WHERE pipeline_execution_items.status NOT IN ('completed', 'failed');
        END IF;
        PERFORM public.enqueue_pipeline_job_v3(v_job_type, v_target.child_id, p_business_date, p_execution_id, p_collection_phase, v_cutoff);

        v_enqueued := v_enqueued + 1;
      END LOOP;
    END IF;
  END IF;

  SELECT count(*)::integer INTO v_existing
  FROM public.pipeline_jobs
  WHERE job_type = v_job_type::public.job_type_enum
    AND business_date = p_business_date;

  RETURN QUERY SELECT p_execution_id, v_cutoff, v_enqueued, v_existing;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_collection_jobs_v3(integer, date, uuid, uuid, timestamptz, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_collection_jobs_v3(integer, date, uuid, uuid, timestamptz, boolean, boolean) TO service_role;
