-- 관리자 수동 "즉시 대화 수집" 실행 시 매번 INVALID_CUTOFF로 실패하던 버그 수정.
--
-- 근본 원인(2026-08-02 실측 확정): app/api/admin/reporting/run/route.ts가 Node.js 서버의
-- 로컬 시계로 "지금" 시각을 계산해 p_cutoff_at으로 넘겼는데, 이 RPC의
-- `p_cutoff_at <= now()` 검증은 Postgres 서버의 시계로 판정한다. 두 서버 시계 사이의
-- 아주 작은(수백 ms) 오차만으로도 cutoff가 "미래"로 오판돼 매번 거부됐다.
--
-- 1차 시도로 p_cutoff_at을 아예 넘기지 않고 기본값(v_sched_end = 다음날 00:00 KST)에
-- 맡겨봤으나, claim_collection_jobs_v3_for_execution이 `cutoff_at <= now()`를 "이 시각이
-- 지나야 작업을 집을 수 있다"는 조건으로도 재사용하고 있어(§ 자동 Cron의 17:55/23:55
-- 스케줄 대기와 동일 메커니즘), cutoff를 자정으로 두면 관리자 수동 실행이 자정까지
-- 클레임되지 않는 새 회귀가 생겼다.
--
-- 최종 수정: 클라이언트가 시각을 계산해 보내지 않고, "지금 즉시"를 원한다는 의도만
-- boolean으로 전달하면 Postgres 자신의 now()로 cutoff를 계산한다 — 서버 간 시계 차이가
-- 원천적으로 개입할 수 없다.
--
-- claude-review 재검증 지적(2026-08-02 확정): CREATE OR REPLACE는 인자 타입 목록이 다르면
-- 기존 함수를 대체하지 않고 새 오버로드를 추가한다. p_use_current_time을 추가하면서
-- DROP 없이 CREATE OR REPLACE만 했더니 기존 6-파라미터 시그니처가 그대로 남아 PostgREST가
-- "함수가 유일하지 않다"는 오류를 내고, 자동 Cron 수집 경로(옛 6-파라미터 그대로 호출)가
-- 전부 이 오류로 실패하는 심각한 회귀가 생겼다(Dev DB 실측 재현·확정). 옛 시그니처를
-- 명시적으로 DROP해 오버로드를 하나로 정리한다.
DROP FUNCTION IF EXISTS public.enqueue_collection_jobs_v3(integer, date, uuid, uuid, timestamptz, boolean);

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
    -- 관리자 수동 "즉시 실행" 전용 경로. 클라이언트 시계를 신뢰하지 않고 Postgres 자신의
    -- now()로 cutoff를 계산해, 스케줄 창을 벗어나지 않으면서도 즉시 클레임 가능하게 한다.
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
    FOR v_target IN
      SELECT DISTINCT s.child_id
      FROM public.chat_messages m
      JOIN public.chat_sessions s ON m.session_id = s.id
      WHERE m.created_at >= v_sched_start
        AND m.created_at < v_cutoff
        AND m.collected_at IS NULL
        AND (
          (s.session_type = 'mission' AND (
            (p_collection_phase = 1 AND s.mission_phase = 1) OR
            (p_collection_phase = 2 AND s.mission_phase IN (1, 2))
          )) OR
          (s.session_type != 'mission')
        )
    LOOP
      IF p_include_downstream AND p_collection_phase = 2 THEN
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

  SELECT count(*)::integer INTO v_existing
  FROM public.pipeline_jobs
  WHERE job_type = v_job_type::public.job_type_enum
    AND business_date = p_business_date;

  RETURN QUERY SELECT p_execution_id, v_cutoff, v_enqueued, v_existing;
END;
$$;
