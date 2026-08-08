-- P0: night-only 사용자가 Phase2 후보에서 영구 제외되는 회귀를 forward-fix한다.
-- 기존 migration은 수정하지 않는다. 모든 생성은 child/date/job/version 멱등 키로 보호한다.

BEGIN;

ALTER TABLE public.pipeline_jobs
  ADD COLUMN IF NOT EXISTS generation_version integer NOT NULL DEFAULT 1
  CHECK (generation_version >= 1);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.pipeline_jobs
    GROUP BY child_id, business_date, job_type, generation_version
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'PIPELINE_JOB_DUPLICATES_EXIST';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pipeline_jobs_child_date_type_generation
  ON public.pipeline_jobs (child_id, business_date, job_type, generation_version);

CREATE OR REPLACE FUNCTION public.ensure_collection_1_zero_marker_v3(
  p_child_id uuid,
  p_business_date date,
  p_execution_id uuid,
  p_generation_version integer DEFAULT 1
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job_id uuid;
  v_cutoff timestamptz := (p_business_date::text || ' 17:55:00+09')::timestamptz;
BEGIN
  IF p_child_id IS NULL OR p_business_date IS NULL OR p_execution_id IS NULL OR p_generation_version < 1 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat(p_child_id::text, '_', p_business_date::text, '_collection_1_', p_generation_version::text), 0
  ));

  SELECT id INTO v_job_id
  FROM public.pipeline_jobs
  WHERE child_id = p_child_id
    AND business_date = p_business_date
    AND job_type = 'collection_1'
    AND generation_version = p_generation_version
  LIMIT 1;

  IF v_job_id IS NULL THEN
    INSERT INTO public.pipeline_jobs (
      job_type, child_id, business_date, collection_phase, cutoff_at, execution_id,
      status, attempt_count, max_attempts, completed_at, idempotency_key,
      generation_version, created_at, updated_at
    ) VALUES (
      'collection_1', p_child_id, p_business_date, 1, v_cutoff, p_execution_id,
      'completed', 0, 3, now(),
      CASE
        WHEN p_generation_version = 1
          THEN concat('collection_1_', p_child_id::text, '_', p_business_date::text, '_1')
        ELSE concat('collection_1_', p_child_id::text, '_', p_business_date::text, '_1_v', p_generation_version::text)
      END,
      p_generation_version, now(), now()
    )
    RETURNING id INTO v_job_id;

    INSERT INTO public.raw_daily_conversations_v3 (
      child_id, business_date, collection_1_status, collection_1_cutoff, created_at, updated_at
    ) VALUES (
      p_child_id, p_business_date, 'completed', v_cutoff, now(), now()
    )
    ON CONFLICT (child_id, business_date) DO UPDATE SET
      collection_1_status = CASE
        WHEN raw_daily_conversations_v3.collection_1_status IN ('completed', 'collected')
          THEN raw_daily_conversations_v3.collection_1_status
        ELSE 'completed'
      END,
      collection_1_cutoff = COALESCE(raw_daily_conversations_v3.collection_1_cutoff, EXCLUDED.collection_1_cutoff),
      updated_at = now();
  END IF;

  INSERT INTO public.pipeline_execution_items (
    execution_id, job_id, child_id, business_date, job_type, collection_phase,
    status, outcome, item_key, completed_at, updated_at
  ) VALUES (
    p_execution_id, v_job_id, p_child_id, p_business_date, 'collection_1', 1,
    'completed', 'NORMALIZED_ZERO', 'collection_1', now(), now()
  )
  ON CONFLICT (execution_id, child_id, item_key) DO UPDATE SET
    job_id = EXCLUDED.job_id,
    status = 'completed',
    outcome = 'NORMALIZED_ZERO',
    completed_at = COALESCE(pipeline_execution_items.completed_at, now()),
    updated_at = now()
  WHERE pipeline_execution_items.status NOT IN ('completed', 'failed');

  RETURN v_job_id;
END;
$$;

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
  v_target record;
  v_enqueued integer := 0;
  v_existing integer := 0;
BEGIN
  SELECT enabled INTO v_v3_enabled FROM public.pipeline_v3_control WHERE id = 1;
  IF v_v3_enabled IS NOT TRUE THEN RAISE EXCEPTION 'V3_DISABLED'; END IF;
  IF p_collection_phase NOT IN (1, 2) THEN RAISE EXCEPTION 'INVALID_PHASE'; END IF;

  v_job_type := CASE WHEN p_collection_phase = 1 THEN 'collection_1' ELSE 'collection_2' END;
  v_sched_start := (p_business_date::text || ' 00:00:00+09')::timestamptz;
  v_sched_end := CASE WHEN p_collection_phase = 1
    THEN (p_business_date::text || ' 17:55:00+09')::timestamptz
    ELSE ((p_business_date + 1)::text || ' 00:00:00+09')::timestamptz END;

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
    IF NOT EXISTS (SELECT 1 FROM public.child_profiles WHERE id = p_child_id) THEN
      RAISE EXCEPTION 'CHILD_NOT_FOUND';
    END IF;
    IF p_collection_phase = 2 AND NOT EXISTS (
      SELECT 1 FROM public.pipeline_jobs
      WHERE child_id=p_child_id AND business_date=p_business_date AND job_type='collection_1'
    ) THEN
      PERFORM public.ensure_collection_1_zero_marker_v3(p_child_id, p_business_date, p_execution_id, 1);
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
  ELSIF p_collection_phase = 1 THEN
    FOR v_target IN
      SELECT DISTINCT s.child_id
      FROM public.chat_messages m
      JOIN public.chat_sessions s ON m.session_id = s.id
      WHERE m.created_at >= v_sched_start AND m.created_at < v_cutoff
        AND m.collected_at IS NULL
        AND ((s.session_type='mission' AND s.mission_phase=1) OR s.session_type!='mission')
    LOOP
      PERFORM public.enqueue_pipeline_job_v3(v_job_type, v_target.child_id, p_business_date, p_execution_id, 1, v_cutoff);
      v_enqueued := v_enqueued + 1;
    END LOOP;
  ELSE
    FOR v_target IN
      WITH phase2_candidates AS (
        SELECT pj.child_id
        FROM public.pipeline_jobs pj
        WHERE pj.business_date=p_business_date AND pj.job_type='collection_1' AND pj.status='completed'
        UNION
        SELECT DISTINCT s.child_id
        FROM public.chat_messages m
        JOIN public.chat_sessions s ON s.id=m.session_id
        WHERE m.created_at >= v_sched_start AND m.created_at < v_cutoff
          AND m.collected_at IS NULL
          AND ((s.session_type='mission' AND s.mission_phase IN (1,2)) OR s.session_type!='mission')
      )
      SELECT c.child_id FROM phase2_candidates c
      WHERE NOT EXISTS (
        SELECT 1 FROM public.pipeline_jobs ex
        WHERE ex.child_id=c.child_id AND ex.business_date=p_business_date AND ex.job_type='collection_2'
      )
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.pipeline_jobs
        WHERE child_id=v_target.child_id AND business_date=p_business_date AND job_type='collection_1'
      ) THEN
        PERFORM public.ensure_collection_1_zero_marker_v3(v_target.child_id, p_business_date, p_execution_id, 1);
      END IF;
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
      PERFORM public.enqueue_pipeline_job_v3('collection_2', v_target.child_id, p_business_date, p_execution_id, 2, v_cutoff);
      v_enqueued := v_enqueued + 1;
    END LOOP;
  END IF;

  SELECT count(*)::integer INTO v_existing
  FROM public.pipeline_jobs
  WHERE job_type=v_job_type::public.job_type_enum AND business_date=p_business_date;
  RETURN QUERY SELECT p_execution_id, v_cutoff, v_enqueued, v_existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_pipeline_v3(
  p_business_date date,
  p_execution_id uuid
)
RETURNS TABLE (
  normalized_c1 integer,
  enqueued_c2 integer,
  retried_c2 integer,
  enqueued_correction integer,
  enqueued_memory integer,
  enqueued_report integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_child record;
  v_normalized_c1 integer := 0;
  v_enqueued_c2 integer := 0;
  v_retried_c2 integer := 0;
  v_enqueued_correction integer := 0;
  v_enqueued_memory integer := 0;
  v_enqueued_report integer := 0;
  v_start timestamptz := (p_business_date::text || ' 00:00:00+09')::timestamptz;
  v_end timestamptz := ((p_business_date + 1)::text || ' 00:00:00+09')::timestamptz;
BEGIN
  IF p_business_date IS NULL OR p_execution_id IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_business_date > (now() AT TIME ZONE 'Asia/Seoul')::date THEN RAISE EXCEPTION 'FUTURE_DATE'; END IF;

  -- 과거 버그로 C2는 존재하지만 C1 marker만 없는 night-only 행도 정규화한다.
  -- 기존 C2/downstream completed 작업은 절대 재생성하지 않는다.
  FOR v_child IN
    SELECT p.child_id
    FROM public.pipeline_jobs p
    WHERE p.business_date = p_business_date
      AND p.job_type = 'collection_2'
      AND NOT EXISTS (
        SELECT 1 FROM public.pipeline_jobs c1
        WHERE c1.child_id = p.child_id
          AND c1.business_date = p.business_date
          AND c1.job_type = 'collection_1'
      )
  LOOP
    PERFORM public.ensure_collection_1_zero_marker_v3(v_child.child_id, p_business_date, p_execution_id, 1);
    v_normalized_c1 := v_normalized_c1 + 1;
  END LOOP;

  FOR v_child IN
    WITH candidates AS (
      SELECT child_id FROM public.pipeline_jobs
      WHERE business_date=p_business_date AND job_type='collection_1' AND status='completed'
      UNION
      SELECT DISTINCT s.child_id
      FROM public.chat_messages m JOIN public.chat_sessions s ON s.id=m.session_id
      WHERE m.created_at >= v_start AND m.created_at < v_end AND m.collected_at IS NULL
        AND ((s.session_type='mission' AND s.mission_phase IN (1,2)) OR s.session_type!='mission')
    )
    SELECT c.child_id FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.pipeline_jobs p
      WHERE p.child_id=c.child_id AND p.business_date=p_business_date AND p.job_type='collection_2'
    )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.pipeline_jobs
      WHERE child_id=v_child.child_id AND business_date=p_business_date AND job_type='collection_1'
    ) THEN
      PERFORM public.ensure_collection_1_zero_marker_v3(v_child.child_id, p_business_date, p_execution_id, 1);
      v_normalized_c1 := v_normalized_c1 + 1;
    END IF;
    PERFORM public.enqueue_pipeline_job_v3('collection_2', v_child.child_id, p_business_date, p_execution_id, 2, v_end);
    v_enqueued_c2 := v_enqueued_c2 + 1;
  END LOOP;

  FOR v_child IN
    SELECT child_id FROM public.pipeline_jobs
    WHERE business_date=p_business_date AND job_type='collection_2' AND status='failed'
  LOOP
    PERFORM public.enqueue_pipeline_job_v3('collection_2', v_child.child_id, p_business_date, p_execution_id, 2, v_end);
    v_retried_c2 := v_retried_c2 + 1;
  END LOOP;

  FOR v_child IN
    SELECT p.child_id
    FROM public.pipeline_jobs p
    JOIN public.raw_daily_conversations_v3 r USING(child_id,business_date)
    LEFT JOIN public.pipeline_jobs c ON c.child_id=p.child_id AND c.business_date=p.business_date AND c.job_type='context_correction'
    WHERE p.business_date=p_business_date AND p.job_type='collection_2' AND p.status='completed'
      AND r.collection_2_status='completed' AND (c.id IS NULL OR c.status='failed')
  LOOP
    PERFORM public.enqueue_context_correction_job_v3(v_child.child_id, p_business_date, p_execution_id);
    v_enqueued_correction := v_enqueued_correction + 1;
  END LOOP;

  FOR v_child IN
    SELECT c.child_id
    FROM public.pipeline_jobs c
    LEFT JOIN public.pipeline_jobs m ON m.child_id=c.child_id AND m.business_date=c.business_date AND m.job_type='memory_batch'
    WHERE c.business_date=p_business_date AND c.job_type='context_correction' AND c.status='completed'
      AND (m.id IS NULL OR m.status='failed')
  LOOP
    PERFORM public.enqueue_memory_batch_job_v3(v_child.child_id, p_business_date, p_execution_id);
    v_enqueued_memory := v_enqueued_memory + 1;
  END LOOP;

  FOR v_child IN
    SELECT c.child_id
    FROM public.pipeline_jobs c
    LEFT JOIN public.pipeline_jobs d ON d.child_id=c.child_id AND d.business_date=c.business_date AND d.job_type='daily_report'
    WHERE c.business_date=p_business_date AND c.job_type='context_correction' AND c.status='completed'
      AND (d.id IS NULL OR d.status='failed')
  LOOP
    PERFORM public.enqueue_daily_report_job_v3(v_child.child_id, p_business_date, p_execution_id);
    v_enqueued_report := v_enqueued_report + 1;
  END LOOP;

  RETURN QUERY SELECT v_normalized_c1, v_enqueued_c2, v_retried_c2,
    v_enqueued_correction, v_enqueued_memory, v_enqueued_report;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_collection_1_zero_marker_v3(uuid,date,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_collection_1_zero_marker_v3(uuid,date,uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.enqueue_collection_jobs_v3(integer,date,uuid,uuid,timestamptz,boolean,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_collection_jobs_v3(integer,date,uuid,uuid,timestamptz,boolean,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.reconcile_pipeline_v3(date,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_pipeline_v3(date,uuid) TO service_role;

COMMIT;
