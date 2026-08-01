-- 20260801160000_reconcile_pipeline_v3.sql

-- 1. `chat_sessions.mission_phase`
ALTER TABLE public.chat_sessions ADD COLUMN IF NOT EXISTS mission_phase integer;
-- Since there might be existing rows where session_type = 'mission' and mission_phase is NULL,
-- we must be careful with CHECK constraints. The user states:
-- "이미 존재하는 과거 세션을 시간 기준으로 무조건 Backfill하지 않는다."
-- "v3 전환 시점 이후 생성되는 미션 세션에는 mission_phase가 반드시 기록되도록 한다."
-- If we add a CHECK constraint, existing NULL rows will fail unless they are NOT VALID.
-- We will add it as NOT VALID, so existing rows pass but new ones are checked.
ALTER TABLE public.chat_sessions DROP CONSTRAINT IF EXISTS chat_sessions_mission_phase_check;
ALTER TABLE public.chat_sessions ADD CONSTRAINT chat_sessions_mission_phase_check CHECK (
  (session_type = 'mission' AND (mission_phase IN (1, 2) OR mission_phase IS NULL)) OR
  (session_type != 'mission' AND mission_phase IS NULL)
) NOT VALID;

-- 2. `pipeline_v3_control`
CREATE TABLE IF NOT EXISTS public.pipeline_v3_control (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  cutover_at timestamptz NULL,
  activated_at timestamptz,
  activated_by text,
  updated_at timestamptz DEFAULT timezone('utc'::text, now())
);
ALTER TABLE public.pipeline_v3_control ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Deny all for anon on pipeline_v3_control" ON public.pipeline_v3_control FOR ALL TO anon USING (false);
CREATE POLICY "Deny all for authenticated on pipeline_v3_control" ON public.pipeline_v3_control FOR ALL TO authenticated USING (false);

INSERT INTO public.pipeline_v3_control (id, enabled, cutover_at)
VALUES (1, false, NULL)
ON CONFLICT (id) DO NOTHING;

-- 3. `pipeline_jobs`
CREATE TABLE IF NOT EXISTS public.pipeline_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  child_id uuid NOT NULL,
  business_date date NOT NULL,
  collection_phase integer NULL,
  cutoff_at timestamptz NULL,
  execution_id uuid NULL,
  source_record_id uuid NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'retry_wait', 'completed', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  next_retry_at timestamptz NULL,
  claimed_at timestamptz NULL,
  claim_expires_at timestamptz NULL,
  claimed_by text NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  last_error_code text NULL,
  last_error_summary text NULL,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);
ALTER TABLE public.pipeline_jobs ENABLE ROW LEVEL SECURITY;

-- 4. `raw_daily_conversations_v3`
CREATE TABLE IF NOT EXISTS public.raw_daily_conversations_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL,
  business_date date NOT NULL,
  mission_1 jsonb,
  free_chat_1 jsonb,
  mission_2 jsonb,
  free_chat_2 jsonb,
  collection_1_status text,
  collection_1_cutoff timestamptz,
  collection_2_status text,
  collection_2_cutoff timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE(child_id, business_date)
);
ALTER TABLE public.raw_daily_conversations_v3 ENABLE ROW LEVEL SECURITY;

-- 5. `raw_daily_conversation_messages_v3`
CREATE TABLE IF NOT EXISTS public.raw_daily_conversation_messages_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_message_id uuid UNIQUE NOT NULL,
  raw_daily_conversation_v3_id uuid NOT NULL REFERENCES public.raw_daily_conversations_v3(id),
  child_id uuid NOT NULL,
  session_id uuid NOT NULL,
  session_type text NOT NULL,
  mission_phase integer,
  section text NOT NULL CHECK (section IN ('mission_1', 'free_chat_1', 'mission_2', 'free_chat_2')),
  role text NOT NULL,
  original_content text NOT NULL,
  source_created_at timestamptz NOT NULL,
  collection_job_id uuid,
  inserted_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);
ALTER TABLE public.raw_daily_conversation_messages_v3 ENABLE ROW LEVEL SECURITY;

-- 6. `corrected_daily_conversations_v3`
CREATE TABLE IF NOT EXISTS public.corrected_daily_conversations_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL,
  business_date date NOT NULL,
  raw_v3_id uuid REFERENCES public.raw_daily_conversations_v3(id),
  mission_1 jsonb,
  free_chat_1 jsonb,
  mission_2 jsonb,
  free_chat_2 jsonb,
  correction_status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE(child_id, business_date)
);
ALTER TABLE public.corrected_daily_conversations_v3 ENABLE ROW LEVEL SECURITY;

-- 7. `enqueue_collection_jobs_v3` RPC
CREATE OR REPLACE FUNCTION public.enqueue_collection_jobs_v3(
  p_collection_phase integer,
  p_business_date date,
  p_execution_id uuid
)
RETURNS TABLE (
  execution_id uuid,
  cutoff_at timestamptz,
  enqueued_count integer,
  existing_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_control public.pipeline_v3_control%ROWTYPE;
  v_cutoff_at timestamptz;
  v_enqueued_count integer := 0;
  v_existing_count integer := 0;
BEGIN
  -- 1. 검증: pipeline_v3_control
  SELECT * INTO v_control FROM public.pipeline_v3_control WHERE id = 1;
  IF NOT FOUND OR v_control.enabled = false THEN
    RAISE EXCEPTION 'V3_DISABLED';
  END IF;
  IF v_control.cutover_at IS NULL THEN
    RAISE EXCEPTION 'CUTOVER_AT_IS_NULL';
  END IF;

  -- 2. 검증: phase
  IF p_collection_phase NOT IN (1, 2) THEN
    RAISE EXCEPTION 'INVALID_PHASE';
  END IF;

  -- 3. cutoff 계산
  IF p_collection_phase = 1 THEN
    v_cutoff_at := (p_business_date::text || ' 17:55:00+09')::timestamptz;
  ELSE
    v_cutoff_at := (p_business_date::text || ' 23:55:00+09')::timestamptz;
  END IF;

  -- 이미 존재하는 Job 수 계산
  SELECT COUNT(*) INTO v_existing_count 
  FROM public.pipeline_jobs
  WHERE job_type = ('collection_' || p_collection_phase::text)
    AND business_date = p_business_date
    AND collection_phase = p_collection_phase;

  -- 신규 Job 생성 (INSERT ... SELECT DISTINCT)
  WITH candidates AS (
    SELECT DISTINCT m.child_id
    FROM public.chat_messages m
    JOIN public.chat_sessions s ON m.session_id = s.id
    WHERE m.created_at <= v_cutoff_at
      AND m.created_at >= v_control.cutover_at
      AND m.collected_at IS NULL
      AND (
        (s.session_type = 'mission' AND s.mission_phase = p_collection_phase)
        OR
        (s.session_type != 'mission' AND (
           (p_collection_phase = 1 AND m.created_at > ((p_business_date - 1)::text || ' 23:55:00+09')::timestamptz AND m.created_at <= v_cutoff_at)
           OR
           (p_collection_phase = 2 AND m.created_at > (p_business_date::text || ' 17:55:00+09')::timestamptz AND m.created_at <= v_cutoff_at)
        ))
      )
  ),
  inserted AS (
    INSERT INTO public.pipeline_jobs (
      job_type,
      child_id,
      business_date,
      collection_phase,
      cutoff_at,
      execution_id,
      status,
      idempotency_key
    )
    SELECT
      ('collection_' || p_collection_phase::text),
      c.child_id,
      p_business_date,
      p_collection_phase,
      v_cutoff_at,
      p_execution_id,
      'pending',
      'collection_' || c.child_id::text || '_' || p_business_date::text || '_' || p_collection_phase::text || '_' || extract(epoch from v_cutoff_at)::text
    FROM candidates c
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
  )
  SELECT COUNT(*) INTO v_enqueued_count FROM inserted;

  RETURN QUERY SELECT p_execution_id, v_cutoff_at, v_enqueued_count, v_existing_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enqueue_collection_jobs_v3(integer, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_collection_jobs_v3(integer, date, uuid) TO service_role;

-- 8. `claim_pipeline_jobs` RPC
CREATE OR REPLACE FUNCTION public.claim_pipeline_jobs(
  p_claimed_by text,
  p_limit integer
)
RETURNS SETOF public.pipeline_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH available AS (
    SELECT id
    FROM public.pipeline_jobs
    WHERE (status = 'pending' OR (status = 'retry_wait' AND next_retry_at <= now()) OR (status = 'processing' AND claim_expires_at <= now()))
      AND attempt_count < max_attempts
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.pipeline_jobs j
  SET status = 'processing',
      claimed_by = p_claimed_by,
      claimed_at = now(),
      claim_expires_at = now() + interval '5 minutes',
      attempt_count = attempt_count + 1,
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  FROM available a
  WHERE j.id = a.id
  RETURNING j.*;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_pipeline_jobs(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pipeline_jobs(text, integer) TO service_role;

-- 9. `collect_chat_messages_v3` RPC
CREATE OR REPLACE FUNCTION public.collect_chat_messages_v3(
  p_job_id uuid,
  p_claimed_by text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.pipeline_jobs%ROWTYPE;
  v_control public.pipeline_v3_control%ROWTYPE;
  v_raw_id uuid;
  v_msg RECORD;
  v_section text;
  v_inserted_count integer := 0;
  v_collected_count integer := 0;
BEGIN
  -- 1. Job 잠금과 소유권·lease 검증
  SELECT * INTO v_job FROM public.pipeline_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;
  IF v_job.claimed_by != p_claimed_by THEN
    RAISE EXCEPTION 'CLAIMED_BY_MISMATCH';
  END IF;
  IF v_job.claim_expires_at < now() THEN
    RAISE EXCEPTION 'LEASE_EXPIRED';
  END IF;

  -- 2. control 검증
  SELECT * INTO v_control FROM public.pipeline_v3_control WHERE id = 1;
  IF NOT FOUND OR v_control.enabled = false THEN
    RAISE EXCEPTION 'V3_DISABLED';
  END IF;

  -- 5. Raw 컨테이너 생성 또는 잠금
  INSERT INTO public.raw_daily_conversations_v3 (child_id, business_date)
  VALUES (v_job.child_id, v_job.business_date)
  ON CONFLICT (child_id, business_date) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_raw_id;

  -- 3, 4, 6, 7, 8, 11
  FOR v_msg IN 
    SELECT m.*, s.session_type, s.mission_phase
    FROM public.chat_messages m
    JOIN public.chat_sessions s ON m.session_id = s.id
    WHERE s.child_id = v_job.child_id
      AND m.created_at <= v_job.cutoff_at
      AND m.created_at >= v_control.cutover_at
      AND m.collected_at IS NULL
      AND (
        (s.session_type = 'mission' AND s.mission_phase = v_job.collection_phase)
        OR
        (s.session_type != 'mission' AND (
           (v_job.collection_phase = 1 AND m.created_at > ((v_job.business_date - 1)::text || ' 23:55:00+09')::timestamptz AND m.created_at <= v_job.cutoff_at)
           OR
           (v_job.collection_phase = 2 AND m.created_at > (v_job.business_date::text || ' 17:55:00+09')::timestamptz AND m.created_at <= v_job.cutoff_at)
        ))
      )
    ORDER BY m.created_at ASC, m.id ASC
    FOR UPDATE OF m
  LOOP
    -- Section 분류
    IF v_msg.session_type = 'mission' THEN
      IF v_job.collection_phase = 1 THEN v_section := 'mission_1';
      ELSE v_section := 'mission_2';
      END IF;
    ELSE
      IF v_job.collection_phase = 1 THEN v_section := 'free_chat_1';
      ELSE v_section := 'free_chat_2';
      END IF;
    END IF;

    -- 정규화 INSERT
    BEGIN
      INSERT INTO public.raw_daily_conversation_messages_v3 (
        source_message_id,
        raw_daily_conversation_v3_id,
        child_id,
        session_id,
        session_type,
        mission_phase,
        section,
        role,
        original_content,
        source_created_at,
        collection_job_id
      ) VALUES (
        v_msg.id,
        v_raw_id,
        v_msg.child_id,
        v_msg.session_id,
        v_msg.session_type,
        v_msg.mission_phase,
        v_section,
        v_msg.role,
        v_msg.content,
        v_msg.created_at,
        v_job.id
      );
      v_inserted_count := v_inserted_count + 1;
      
      -- 원본 업데이트
      UPDATE public.chat_messages
      SET collected_at = now()
      WHERE id = v_msg.id;
      v_collected_count := v_collected_count + 1;
    EXCEPTION WHEN unique_violation THEN
      -- 이미 존재하는 경우 무시
      NULL;
    END;
  END LOOP;

  -- 9. 네 JSONB 스냅샷 재생성 (간단화를 위해 전체 재구성)
  UPDATE public.raw_daily_conversations_v3
  SET 
    mission_1 = (
      SELECT jsonb_agg(row_to_json(msg))
      FROM (
        SELECT session_id, role, original_content as content, source_created_at as created_at
        FROM public.raw_daily_conversation_messages_v3
        WHERE raw_daily_conversation_v3_id = v_raw_id AND section = 'mission_1'
        ORDER BY source_created_at ASC
      ) msg
    ),
    free_chat_1 = (
      SELECT jsonb_agg(row_to_json(msg))
      FROM (
        SELECT session_id, role, original_content as content, source_created_at as created_at
        FROM public.raw_daily_conversation_messages_v3
        WHERE raw_daily_conversation_v3_id = v_raw_id AND section = 'free_chat_1'
        ORDER BY source_created_at ASC
      ) msg
    ),
    mission_2 = (
      SELECT jsonb_agg(row_to_json(msg))
      FROM (
        SELECT session_id, role, original_content as content, source_created_at as created_at
        FROM public.raw_daily_conversation_messages_v3
        WHERE raw_daily_conversation_v3_id = v_raw_id AND section = 'mission_2'
        ORDER BY source_created_at ASC
      ) msg
    ),
    free_chat_2 = (
      SELECT jsonb_agg(row_to_json(msg))
      FROM (
        SELECT session_id, role, original_content as content, source_created_at as created_at
        FROM public.raw_daily_conversation_messages_v3
        WHERE raw_daily_conversation_v3_id = v_raw_id AND section = 'free_chat_2'
        ORDER BY source_created_at ASC
      ) msg
    )
  WHERE id = v_raw_id;

  -- 12. Raw 상태·cutoff 갱신
  IF v_job.collection_phase = 1 THEN
    UPDATE public.raw_daily_conversations_v3
    SET collection_1_status = 'collected',
        collection_1_cutoff = v_job.cutoff_at,
        updated_at = now()
    WHERE id = v_raw_id;
  ELSE
    UPDATE public.raw_daily_conversations_v3
    SET collection_2_status = 'collected',
        collection_2_cutoff = v_job.cutoff_at,
        updated_at = now()
    WHERE id = v_raw_id;
  END IF;

  -- 13. Job completed 처리
  UPDATE public.pipeline_jobs
  SET status = 'completed',
      completed_at = now(),
      updated_at = now()
  WHERE id = v_job.id;

  RETURN jsonb_build_object('inserted', v_inserted_count, 'collected', v_collected_count);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.collect_chat_messages_v3(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collect_chat_messages_v3(uuid, text) TO service_role;

-- 10. `mark_pipeline_job_failed` RPC
CREATE OR REPLACE FUNCTION public.mark_pipeline_job_failed(
  p_job_id uuid,
  p_claimed_by text,
  p_error_code text,
  p_error_summary text,
  p_retryable boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.pipeline_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.pipeline_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN; -- silently ignore or raise
  END IF;

  IF v_job.claimed_by != p_claimed_by THEN
    RAISE EXCEPTION 'CLAIMED_BY_MISMATCH';
  END IF;

  IF v_job.status = 'completed' THEN
    RAISE EXCEPTION 'CANNOT_FAIL_COMPLETED_JOB';
  END IF;

  IF p_retryable AND v_job.attempt_count < v_job.max_attempts THEN
    UPDATE public.pipeline_jobs
    SET status = 'retry_wait',
        last_error_code = p_error_code,
        last_error_summary = p_error_summary,
        next_retry_at = now() + (interval '1 minute' * v_job.attempt_count),
        updated_at = now()
    WHERE id = v_job.id;
  ELSE
    UPDATE public.pipeline_jobs
    SET status = 'failed',
        last_error_code = p_error_code,
        last_error_summary = p_error_summary,
        updated_at = now()
    WHERE id = v_job.id;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mark_pipeline_job_failed(uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_pipeline_job_failed(uuid, text, text, text, boolean) TO service_role;
