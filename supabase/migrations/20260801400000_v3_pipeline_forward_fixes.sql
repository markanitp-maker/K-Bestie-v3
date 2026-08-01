-- 20260801400000_v3_pipeline_forward_fixes.sql
-- Final Architecture Forward Migration for V3 Pipeline & Mission Expiry

BEGIN;

-- 1. Schema Extensions
ALTER TABLE public.corrected_daily_conversations_v3
  ADD COLUMN IF NOT EXISTS report_generated_at timestamptz;

ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS ended_reason text;

-- Validate and enforce raw_daily_conversation_messages_v3.child_id NOT NULL
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'raw_daily_conversation_messages_v3'
      AND column_name = 'child_id'
      AND is_nullable = 'YES'
  ) THEN
    UPDATE public.raw_daily_conversation_messages_v3 m
    SET child_id = c.child_id
    FROM public.raw_daily_conversations_v3 c
    WHERE m.raw_daily_conversation_v3_id = c.id
      AND m.child_id IS NULL;

    ALTER TABLE public.raw_daily_conversation_messages_v3
      ALTER COLUMN child_id SET NOT NULL;
  END IF;
END $$;

-- 2. Create clean final table: pipeline_execution_items with (execution_id, child_id, item_key) UNIQUE
CREATE TABLE IF NOT EXISTS public.pipeline_execution_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  execution_id uuid NOT NULL,
  job_id uuid REFERENCES public.pipeline_jobs(id) ON DELETE SET NULL,
  child_id uuid NOT NULL REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  job_type text NOT NULL CHECK (job_type IN ('collection_1', 'collection_2', 'context_correction', 'memory_batch', 'daily_report')),
  collection_phase integer CHECK (collection_phase IS NULL OR collection_phase IN (1, 2)),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'retry_wait')),
  outcome text,
  error_code text,
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  item_key text NOT NULL,
  CONSTRAINT pipeline_execution_items_execution_item_key UNIQUE(execution_id, child_id, item_key)
);

-- Ensure UNIQUE constraint on (execution_id, child_id, item_key) if table pre-existed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'pipeline_execution_items_execution_item_key'
      AND table_name = 'pipeline_execution_items'
  ) THEN
    ALTER TABLE public.pipeline_execution_items DROP CONSTRAINT pipeline_execution_items_execution_item_key;
    ALTER TABLE public.pipeline_execution_items ADD CONSTRAINT pipeline_execution_items_execution_item_key UNIQUE(execution_id, child_id, item_key);
  END IF;
END $$;

-- Enable RLS and grants for pipeline_execution_items
ALTER TABLE public.pipeline_execution_items ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.pipeline_execution_items TO service_role;

DROP POLICY IF EXISTS "pipeline_execution_items_service_role_all" ON public.pipeline_execution_items;
CREATE POLICY "pipeline_execution_items_service_role_all"
  ON public.pipeline_execution_items
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT ALL ON public.pipeline_execution_items TO anon, authenticated;

DROP POLICY IF EXISTS "pipeline_execution_items_client_select" ON public.pipeline_execution_items;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_pipeline_exec_items_exec_id ON public.pipeline_execution_items(execution_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_exec_items_job_id ON public.pipeline_execution_items(job_id);

-- 3. Drop obsolete function overloads before redefining
DROP FUNCTION IF EXISTS public.enqueue_pipeline_job_v3(text, uuid, date, uuid, integer, timestamptz);
DROP FUNCTION IF EXISTS public.enqueue_pipeline_job_v3(text, uuid, date, uuid, text, integer, timestamptz, integer);

DROP FUNCTION IF EXISTS public.enqueue_collection_jobs_v3(integer, date, uuid);
DROP FUNCTION IF EXISTS public.enqueue_collection_jobs_v3(integer, date, uuid, uuid);
DROP FUNCTION IF EXISTS public.enqueue_collection_jobs_v3(integer, date, uuid, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.enqueue_collection_jobs_v3(integer, date, uuid, uuid, timestamptz, boolean);

DROP FUNCTION IF EXISTS public.enqueue_context_correction_job_v3(uuid, date, uuid);
DROP FUNCTION IF EXISTS public.enqueue_memory_batch_job_v3(uuid, date, uuid);
DROP FUNCTION IF EXISTS public.enqueue_daily_report_job_v3(uuid, date, uuid);

DROP FUNCTION IF EXISTS public.claim_collection_jobs_v3_for_execution(uuid, text, integer, integer);
DROP FUNCTION IF EXISTS public.claim_context_correction_jobs_v3_for_execution(uuid, text, integer);
DROP FUNCTION IF EXISTS public.claim_memory_batch_jobs_v3_for_execution(uuid, text, integer);
DROP FUNCTION IF EXISTS public.claim_daily_report_jobs_v3_for_execution(uuid, text, integer);

DROP FUNCTION IF EXISTS public.complete_context_correction_job_v3(uuid, text, uuid, uuid, date, text, text, integer, integer, jsonb);
DROP FUNCTION IF EXISTS public.complete_memory_batch_job_v3(uuid, text, text);
DROP FUNCTION IF EXISTS public.fail_memory_batch_job_v3(uuid, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.complete_daily_report_job_v3(uuid, text, uuid, date, uuid, text);
DROP FUNCTION IF EXISTS public.mark_pipeline_job_failed_v3(uuid, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.force_end_mission_session_if_expired(uuid);


-- 4. Atomic Enqueue Core RPC
CREATE OR REPLACE FUNCTION public.enqueue_pipeline_job_v3(
  p_job_type text,
  p_child_id uuid,
  p_business_date date,
  p_execution_id uuid,
  p_collection_phase integer DEFAULT NULL,
  p_cutoff_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_typed_job_type public.job_type_enum;
  v_item_key text;
  v_idempotency_key text;
  v_job_id uuid;
  v_job_status text;
  v_cutoff timestamptz;
BEGIN
  IF p_child_id IS NULL OR p_business_date IS NULL OR p_execution_id IS NULL OR p_job_type IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: child_id, business_date, execution_id, and job_type are required';
  END IF;

  v_typed_job_type := p_job_type::public.job_type_enum;

  -- Advisory lock per child/date/job_type/phase
  PERFORM pg_advisory_xact_lock(hashtextextended(concat(p_child_id::text, '_', p_business_date::text, '_', p_job_type, '_', COALESCE(p_collection_phase::text, '')), 0));

  v_item_key := CASE 
    WHEN p_job_type IN ('collection_1', 'collection_2') THEN concat('collection_', COALESCE(p_collection_phase, CASE WHEN p_job_type = 'collection_1' THEN 1 ELSE 2 END)::text)
    ELSE p_job_type
  END;

  v_idempotency_key := concat(p_job_type, '_', p_child_id::text, '_', p_business_date::text, CASE WHEN p_collection_phase IS NOT NULL THEN '_' || p_collection_phase::text ELSE '' END);

  v_cutoff := COALESCE(
    p_cutoff_at,
    CASE 
      WHEN p_collection_phase = 1 OR p_job_type = 'collection_1' THEN (p_business_date::text || ' 17:55:00+09')::timestamptz
      WHEN p_collection_phase = 2 OR p_job_type = 'collection_2' THEN ((p_business_date + 1)::text || ' 00:00:00+09')::timestamptz
      ELSE now()
    END
  );

  -- Look up existing canonical job in pipeline_jobs
  SELECT id, status INTO v_job_id, v_job_status
  FROM public.pipeline_jobs
  WHERE child_id = p_child_id 
    AND business_date = p_business_date 
    AND job_type = v_typed_job_type
  LIMIT 1;

  IF v_job_id IS NULL THEN
    SELECT id, status INTO v_job_id, v_job_status
    FROM public.pipeline_jobs
    WHERE idempotency_key = v_idempotency_key
    LIMIT 1;
  END IF;

  IF v_job_id IS NOT NULL THEN

    IF v_job_status = 'completed' THEN
      DECLARE
        v_uncollected integer := 0;
      BEGIN
        IF v_typed_job_type IN ('collection_1'::public.job_type_enum, 'collection_2'::public.job_type_enum) THEN
          SELECT count(*)::integer INTO v_uncollected
          FROM public.chat_messages m
          JOIN public.chat_sessions s ON m.session_id = s.id
          WHERE s.child_id = p_child_id
            AND m.created_at >= (p_business_date::text || ' 00:00:00+09')::timestamptz
            AND m.created_at < v_cutoff
            AND m.collected_at IS NULL
            AND (
              (s.session_type = 'mission' AND (
                (p_collection_phase = 1 AND s.mission_phase = 1) OR
                (p_collection_phase = 2 AND s.mission_phase IN (1, 2))
              )) OR
              (s.session_type != 'mission')
            );
        END IF;

        IF v_uncollected > 0 THEN
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
              cutoff_at = v_cutoff,
              updated_at = now()
          WHERE id = v_job_id;

          INSERT INTO public.pipeline_execution_items (
            execution_id, job_id, child_id, business_date, job_type, collection_phase, status, item_key, updated_at
          ) VALUES (
            p_execution_id, v_job_id, p_child_id, p_business_date, p_job_type, p_collection_phase, 'pending', v_item_key, now()
          ) ON CONFLICT (execution_id, child_id, item_key) DO UPDATE SET
            job_id = EXCLUDED.job_id,
            status = 'pending',
            outcome = NULL,
            error_code = NULL,
            error_summary = NULL,
            updated_at = now()
          WHERE pipeline_execution_items.status NOT IN ('completed', 'failed');
        ELSE
          INSERT INTO public.pipeline_execution_items (
            execution_id, job_id, child_id, business_date, job_type, collection_phase, status, outcome, item_key, completed_at, updated_at
          ) VALUES (
            p_execution_id, v_job_id, p_child_id, p_business_date, p_job_type, p_collection_phase, 'completed', 'ALREADY_COMPLETED', v_item_key, now(), now()
          ) ON CONFLICT (execution_id, child_id, item_key) DO UPDATE SET
            job_id = EXCLUDED.job_id,
            status = 'completed',
            outcome = 'ALREADY_COMPLETED',
            completed_at = COALESCE(pipeline_execution_items.completed_at, now()),
            updated_at = now()
          WHERE pipeline_execution_items.status NOT IN ('completed', 'failed');

          IF v_typed_job_type = 'memory_batch'::public.job_type_enum THEN
            PERFORM public.enqueue_daily_report_job_v3(p_child_id, p_business_date, p_execution_id);
          ELSIF v_typed_job_type = 'collection_2'::public.job_type_enum THEN
            DECLARE
              v_raw_count integer := 0;
            BEGIN
              SELECT count(*)::integer INTO v_raw_count
              FROM public.raw_daily_conversation_messages_v3 m
              JOIN public.raw_daily_conversations_v3 c ON c.id = m.raw_daily_conversation_v3_id
              WHERE c.child_id = p_child_id AND c.business_date = p_business_date;

              IF v_raw_count > 0 THEN
                IF EXISTS (
                  SELECT 1 FROM public.pipeline_execution_items c_item
                  WHERE c_item.execution_id = p_execution_id
                    AND c_item.child_id = p_child_id
                    AND c_item.job_type = 'context_correction'
                    AND c_item.status NOT IN ('completed', 'failed')
                ) THEN
                  PERFORM public.enqueue_context_correction_job_v3(p_child_id, p_business_date, p_execution_id);
                END IF;
              ELSE
                UPDATE public.pipeline_execution_items
                SET status = 'completed',
                    outcome = 'NO_CONVERSATION',
                    completed_at = now(),
                    updated_at = now()
                WHERE execution_id = p_execution_id
                  AND child_id = p_child_id
                  AND business_date = p_business_date
                  AND job_type IN ('context_correction', 'memory_batch', 'daily_report')
                  AND status NOT IN ('completed', 'failed');
              END IF;
            END;
          END IF;
        END IF;
      END;
    ELSIF v_job_status = 'failed' THEN
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
      WHERE id = v_job_id;

      INSERT INTO public.pipeline_execution_items (
        execution_id, job_id, child_id, business_date, job_type, collection_phase, status, item_key, updated_at
      ) VALUES (
        p_execution_id, v_job_id, p_child_id, p_business_date, p_job_type, p_collection_phase, 'pending', v_item_key, now()
      ) ON CONFLICT (execution_id, child_id, item_key) DO UPDATE SET
        job_id = EXCLUDED.job_id,
        status = 'pending',
        outcome = NULL,
        error_code = NULL,
        error_summary = NULL,
        updated_at = now()
      WHERE pipeline_execution_items.status NOT IN ('completed', 'failed');

    ELSE
      INSERT INTO public.pipeline_execution_items (
        execution_id, job_id, child_id, business_date, job_type, collection_phase, status, item_key, updated_at
      ) VALUES (
        p_execution_id, v_job_id, p_child_id, p_business_date, p_job_type, p_collection_phase, 'pending', v_item_key, now()
      ) ON CONFLICT (execution_id, child_id, item_key) DO UPDATE SET
        job_id = EXCLUDED.job_id,
        status = CASE WHEN pipeline_execution_items.status IN ('completed', 'failed') THEN pipeline_execution_items.status ELSE 'pending' END,
        updated_at = now()
      WHERE pipeline_execution_items.status NOT IN ('completed', 'failed');
    END IF;

  ELSE
    v_job_id := gen_random_uuid();
    INSERT INTO public.pipeline_jobs (
      id, job_type, child_id, business_date, collection_phase, cutoff_at,
      execution_id, status, attempt_count, max_attempts, next_retry_at, idempotency_key, created_at, updated_at
    ) VALUES (
      v_job_id, v_typed_job_type, p_child_id, p_business_date, p_collection_phase, v_cutoff,
      p_execution_id, 'pending', 0, 3, now(), v_idempotency_key, now(), now()
    );

    INSERT INTO public.pipeline_execution_items (
      execution_id, job_id, child_id, business_date, job_type, collection_phase, status, item_key, updated_at
    ) VALUES (
      p_execution_id, v_job_id, p_child_id, p_business_date, p_job_type, p_collection_phase, 'pending', v_item_key, now()
    ) ON CONFLICT (execution_id, child_id, item_key) DO UPDATE SET
      job_id = EXCLUDED.job_id,
      status = 'pending',
      updated_at = now()
    WHERE pipeline_execution_items.status NOT IN ('completed', 'failed');
  END IF;

  RETURN v_job_id;
END;
$$;


-- 5. Collection Enqueue RPC Wrapper
CREATE OR REPLACE FUNCTION public.enqueue_collection_jobs_v3(
  p_collection_phase integer,
  p_business_date date,
  p_execution_id uuid,
  p_child_id uuid DEFAULT NULL,
  p_cutoff_at timestamptz DEFAULT NULL,
  p_include_downstream boolean DEFAULT false
)
RETURNS TABLE (
  execution_id uuid,
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

  -- Validate manual p_cutoff_at if provided
  IF p_cutoff_at IS NOT NULL THEN
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


-- 6. Context Correction Enqueue RPC Wrapper
CREATE OR REPLACE FUNCTION public.enqueue_context_correction_job_v3(
  p_child_id uuid,
  p_business_date date,
  p_execution_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  IF NOT EXISTS (
    SELECT 1 FROM public.pipeline_execution_items
    WHERE execution_id = p_execution_id
      AND child_id = p_child_id
      AND business_date = p_business_date
      AND job_type = 'context_correction'
      AND status NOT IN ('completed', 'failed')
  ) THEN
    RETURN NULL;
  END IF;

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
$$;


-- 7. Memory & Daily Report Enqueue Wrappers (RETURNS void)
CREATE OR REPLACE FUNCTION public.enqueue_memory_batch_job_v3(
  p_child_id uuid,
  p_business_date date,
  p_execution_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.enqueue_pipeline_job_v3('memory_batch', p_child_id, p_business_date, p_execution_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_daily_report_job_v3(
  p_child_id uuid,
  p_business_date date,
  p_execution_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.enqueue_pipeline_job_v3('daily_report', p_child_id, p_business_date, p_execution_id);
END;
$$;


-- 8. Execution-Scoped Claim RPCs
CREATE OR REPLACE FUNCTION public.claim_collection_jobs_v3_for_execution(
  p_execution_id uuid,
  p_claimed_by text,
  p_limit integer,
  p_collection_phase integer DEFAULT 2
)
RETURNS SETOF public.pipeline_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_type public.job_type_enum;
  v_job_ids uuid[];
BEGIN
  v_target_type := CASE WHEN p_collection_phase = 1 THEN 'collection_1'::public.job_type_enum ELSE 'collection_2'::public.job_type_enum END;

  SELECT array_agg(j.id) INTO v_job_ids
  FROM (
    SELECT j.id
    FROM public.pipeline_jobs j
    JOIN public.pipeline_execution_items e ON e.job_id = j.id
    WHERE e.execution_id = p_execution_id
      AND e.child_id = j.child_id
      AND e.status IN ('pending', 'retry_wait', 'processing')
      AND j.status IN ('pending', 'retry_wait', 'processing')
      AND (j.status != 'processing' OR j.claim_expires_at <= now())
      AND j.attempt_count < j.max_attempts
      AND j.job_type = v_target_type
      AND (j.cutoff_at IS NULL OR j.cutoff_at <= now())
      AND (j.next_retry_at IS NULL OR j.next_retry_at <= now())
    ORDER BY j.created_at ASC
    FOR UPDATE OF j SKIP LOCKED
    LIMIT p_limit
  ) j;

  IF v_job_ids IS NULL OR array_length(v_job_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.pipeline_jobs
  SET status = 'processing',
      claimed_by = p_claimed_by,
      claimed_at = now(),
      claim_expires_at = now() + interval '5 minutes',
      attempt_count = attempt_count + 1,
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  WHERE id = ANY(v_job_ids);

  UPDATE public.pipeline_execution_items
  SET status = 'processing',
      updated_at = now()
  WHERE execution_id = p_execution_id AND job_id = ANY(v_job_ids) AND status NOT IN ('completed', 'failed');

  RETURN QUERY SELECT * FROM public.pipeline_jobs WHERE id = ANY(v_job_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_context_correction_jobs_v3_for_execution(
  p_execution_id uuid,
  p_claimed_by text,
  p_limit integer
)
RETURNS SETOF public.pipeline_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job_ids uuid[];
BEGIN
  SELECT array_agg(j.id) INTO v_job_ids
  FROM (
    SELECT j.id
    FROM public.pipeline_jobs j
    JOIN public.pipeline_execution_items e ON e.job_id = j.id
    WHERE e.execution_id = p_execution_id
      AND e.child_id = j.child_id
      AND e.status IN ('pending', 'retry_wait', 'processing')
      AND j.status IN ('pending', 'retry_wait', 'processing')
      AND (j.status != 'processing' OR j.claim_expires_at <= now())
      AND j.attempt_count < j.max_attempts
      AND j.job_type = 'context_correction'::public.job_type_enum
      AND (j.next_retry_at IS NULL OR j.next_retry_at <= now())
    ORDER BY j.created_at ASC
    FOR UPDATE OF j SKIP LOCKED
    LIMIT p_limit
  ) j;

  IF v_job_ids IS NULL OR array_length(v_job_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.pipeline_jobs
  SET status = 'processing',
      claimed_by = p_claimed_by,
      claimed_at = now(),
      claim_expires_at = now() + interval '5 minutes',
      attempt_count = attempt_count + 1,
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  WHERE id = ANY(v_job_ids);

  UPDATE public.pipeline_execution_items
  SET status = 'processing',
      updated_at = now()
  WHERE execution_id = p_execution_id AND job_id = ANY(v_job_ids) AND status NOT IN ('completed', 'failed');

  RETURN QUERY SELECT * FROM public.pipeline_jobs WHERE id = ANY(v_job_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_memory_batch_jobs_v3_for_execution(
  p_execution_id uuid,
  p_claimed_by text,
  p_limit integer
)
RETURNS SETOF public.pipeline_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job_ids uuid[];
BEGIN
  SELECT array_agg(j.id) INTO v_job_ids
  FROM (
    SELECT j.id
    FROM public.pipeline_jobs j
    JOIN public.pipeline_execution_items e ON e.job_id = j.id
    WHERE e.execution_id = p_execution_id
      AND e.child_id = j.child_id
      AND e.status IN ('pending', 'retry_wait', 'processing')
      AND j.status IN ('pending', 'retry_wait', 'processing')
      AND (j.status != 'processing' OR j.claim_expires_at <= now())
      AND j.attempt_count < j.max_attempts
      AND j.job_type = 'memory_batch'::public.job_type_enum
      AND (j.next_retry_at IS NULL OR j.next_retry_at <= now())
    ORDER BY j.created_at ASC
    FOR UPDATE OF j SKIP LOCKED
    LIMIT p_limit
  ) j;

  IF v_job_ids IS NULL OR array_length(v_job_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.pipeline_jobs
  SET status = 'processing',
      claimed_by = p_claimed_by,
      claimed_at = now(),
      claim_expires_at = now() + interval '5 minutes',
      attempt_count = attempt_count + 1,
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  WHERE id = ANY(v_job_ids);

  UPDATE public.pipeline_execution_items
  SET status = 'processing',
      updated_at = now()
  WHERE execution_id = p_execution_id AND job_id = ANY(v_job_ids) AND status NOT IN ('completed', 'failed');

  RETURN QUERY SELECT * FROM public.pipeline_jobs WHERE id = ANY(v_job_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_daily_report_jobs_v3_for_execution(
  p_execution_id uuid,
  p_claimed_by text,
  p_limit integer
)
RETURNS SETOF public.pipeline_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job_ids uuid[];
BEGIN
  SELECT array_agg(j.id) INTO v_job_ids
  FROM (
    SELECT j.id
    FROM public.pipeline_jobs j
    JOIN public.pipeline_execution_items e ON e.job_id = j.id
    WHERE e.execution_id = p_execution_id
      AND e.child_id = j.child_id
      AND e.status IN ('pending', 'retry_wait', 'processing')
      AND j.status IN ('pending', 'retry_wait', 'processing')
      AND (j.status != 'processing' OR j.claim_expires_at <= now())
      AND j.attempt_count < j.max_attempts
      AND j.job_type = 'daily_report'::public.job_type_enum
      AND (j.next_retry_at IS NULL OR j.next_retry_at <= now())
    ORDER BY j.created_at ASC
    FOR UPDATE OF j SKIP LOCKED
    LIMIT p_limit
  ) j;

  IF v_job_ids IS NULL OR array_length(v_job_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.pipeline_jobs
  SET status = 'processing',
      claimed_by = p_claimed_by,
      claimed_at = now(),
      claim_expires_at = now() + interval '5 minutes',
      attempt_count = attempt_count + 1,
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  WHERE id = ANY(v_job_ids);

  UPDATE public.pipeline_execution_items
  SET status = 'processing',
      updated_at = now()
  WHERE execution_id = p_execution_id AND job_id = ANY(v_job_ids) AND status NOT IN ('completed', 'failed');

  RETURN QUERY SELECT * FROM public.pipeline_jobs WHERE id = ANY(v_job_ids);
END;
$$;


-- 9. Completion & Failure RPCs
CREATE OR REPLACE FUNCTION public.complete_context_correction_job_v3(
  p_job_id uuid,
  p_claimed_by text,
  p_raw_daily_conversation_v3_id uuid,
  p_child_id uuid,
  p_business_date date,
  p_model text,
  p_prompt_version text,
  p_source_message_count integer,
  p_corrected_message_count integer,
  p_messages jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.pipeline_jobs%ROWTYPE;
  v_corr_id uuid;
  v_msg jsonb;
  v_exec_rec RECORD;
BEGIN
  SELECT * INTO v_job FROM public.pipeline_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;
  IF v_job.status != 'processing' OR v_job.claimed_by != p_claimed_by THEN
    RAISE EXCEPTION 'JOB_NOT_CLAIMED_BY_WORKER';
  END IF;
  IF v_job.claim_expires_at < now() THEN
    RAISE EXCEPTION 'LEASE_EXPIRED';
  END IF;

  INSERT INTO public.corrected_daily_conversations_v3 (
    child_id, business_date, raw_daily_conversation_v3_id, correction_status, status, model, prompt_version, source_message_count, corrected_message_count, updated_at
  ) VALUES (
    p_child_id, p_business_date, p_raw_daily_conversation_v3_id, 'completed', 'completed', p_model, p_prompt_version, p_source_message_count, p_corrected_message_count, now()
  )
  ON CONFLICT (child_id, business_date) DO UPDATE SET
    correction_status = 'completed',
    status = 'completed',
    model = p_model,
    prompt_version = p_prompt_version,
    source_message_count = p_source_message_count,
    corrected_message_count = p_corrected_message_count,
    updated_at = now()
  RETURNING id INTO v_corr_id;

  DELETE FROM public.corrected_daily_conversation_messages_v3 WHERE corrected_daily_conversation_id = v_corr_id;

  FOR v_msg IN SELECT * FROM jsonb_array_elements(p_messages)
  LOOP
    INSERT INTO public.corrected_daily_conversation_messages_v3 (
      corrected_daily_conversation_id,
      source_message_id,
      child_id,
      business_date,
      session_id,
      role,
      content,
      created_at,
      section,
      display_sequence,
      correction_metadata,
      inserted_at
    ) VALUES (
      v_corr_id,
      (v_msg->>'source_message_id')::uuid,
      p_child_id,
      p_business_date,
      (v_msg->>'session_id')::uuid,
      v_msg->>'role',
      v_msg->>'content',
      (v_msg->>'original_created_at')::timestamptz,
      v_msg->>'section',
      (v_msg->>'display_sequence')::integer,
      v_msg->'correction_metadata',
      now()
    );
  END LOOP;

  UPDATE public.pipeline_jobs
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = p_job_id;

  FOR v_exec_rec IN 
    WITH updated AS (
      UPDATE public.pipeline_execution_items
      SET status = 'completed', outcome = 'SUCCESS', completed_at = now(), updated_at = now()
      WHERE job_id = p_job_id AND status NOT IN ('completed', 'failed')
      RETURNING execution_id
    )
    SELECT DISTINCT execution_id FROM updated
  LOOP
    PERFORM public.enqueue_memory_batch_job_v3(p_child_id, p_business_date, v_exec_rec.execution_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_memory_batch_job_v3(
  p_job_id uuid,
  p_claimed_by text,
  p_summary_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.pipeline_jobs%ROWTYPE;
  v_exec_rec RECORD;
BEGIN
  SELECT * INTO v_job FROM public.pipeline_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;
  IF v_job.status != 'processing' OR v_job.claimed_by != p_claimed_by THEN
    RAISE EXCEPTION 'JOB_NOT_CLAIMED_BY_WORKER';
  END IF;
  IF v_job.claim_expires_at < now() THEN
    RAISE EXCEPTION 'LEASE_EXPIRED';
  END IF;

  UPDATE public.pipeline_jobs
  SET status = 'completed',
      last_error_summary = p_summary_note,
      completed_at = now(),
      updated_at = now()
  WHERE id = p_job_id;

  FOR v_exec_rec IN 
    WITH updated AS (
      UPDATE public.pipeline_execution_items
      SET status = 'completed',
          outcome = COALESCE(p_summary_note, 'SUCCESS'),
          completed_at = now(),
          updated_at = now()
      WHERE job_id = p_job_id AND status NOT IN ('completed', 'failed')
      RETURNING execution_id
    )
    SELECT DISTINCT execution_id FROM updated
  LOOP
    PERFORM public.enqueue_daily_report_job_v3(v_job.child_id, v_job.business_date, v_exec_rec.execution_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_memory_batch_job_v3(
  p_job_id uuid,
  p_claimed_by text,
  p_error_code text,
  p_error_summary text,
  p_retryable boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.pipeline_jobs%ROWTYPE;
  v_exec_rec RECORD;
BEGIN
  SELECT * INTO v_job FROM public.pipeline_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;
  IF v_job.status != 'processing' OR v_job.claimed_by != p_claimed_by THEN
    RAISE EXCEPTION 'JOB_NOT_CLAIMED_BY_WORKER';
  END IF;
  IF v_job.claim_expires_at < now() THEN
    RAISE EXCEPTION 'LEASE_EXPIRED';
  END IF;

  -- Memory failure is ALWAYS terminal failed so Report is NEVER blocked
  UPDATE public.pipeline_jobs
  SET status = 'failed',
      last_error_code = p_error_code,
      last_error_summary = p_error_summary,
      completed_at = now(),
      updated_at = now()
  WHERE id = p_job_id;

  FOR v_exec_rec IN 
    WITH updated AS (
      UPDATE public.pipeline_execution_items
      SET status = 'failed',
          outcome = 'FAILED',
          error_code = p_error_code,
          error_summary = p_error_summary,
          completed_at = now(),
          updated_at = now()
      WHERE job_id = p_job_id AND status NOT IN ('completed', 'failed')
      RETURNING execution_id
    )
    SELECT DISTINCT execution_id FROM updated
  LOOP
    PERFORM public.enqueue_daily_report_job_v3(v_job.child_id, v_job.business_date, v_exec_rec.execution_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_daily_report_job_v3(
  p_job_id uuid,
  p_claimed_by text,
  p_child_id uuid,
  p_business_date date,
  p_report_id uuid,
  p_summary_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.pipeline_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.pipeline_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;
  IF v_job.status != 'processing' OR v_job.claimed_by != p_claimed_by THEN
    RAISE EXCEPTION 'JOB_NOT_CLAIMED_BY_WORKER';
  END IF;
  IF v_job.claim_expires_at < now() THEN
    RAISE EXCEPTION 'LEASE_EXPIRED';
  END IF;

  UPDATE public.corrected_daily_conversations_v3
  SET report_generated_at = now()
  WHERE child_id = p_child_id AND business_date = p_business_date AND (status = 'completed' OR correction_status = 'completed');

  UPDATE public.pipeline_jobs
  SET status = 'completed',
      last_error_summary = p_summary_note,
      completed_at = now(),
      updated_at = now()
  WHERE id = p_job_id;

  UPDATE public.pipeline_execution_items
  SET status = 'completed',
      outcome = COALESCE(p_summary_note, 'SUCCESS'),
      completed_at = now(),
      updated_at = now()
  WHERE job_id = p_job_id AND status NOT IN ('completed', 'failed');
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_pipeline_job_failed_v3(
  p_job_id uuid,
  p_claimed_by text,
  p_error_code text,
  p_error_summary text,
  p_retryable boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.pipeline_jobs%ROWTYPE;
BEGIN
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

  IF p_retryable AND v_job.attempt_count < v_job.max_attempts THEN
    UPDATE public.pipeline_jobs
    SET status = 'retry_wait',
        last_error_code = p_error_code,
        last_error_summary = p_error_summary,
        next_retry_at = now() + interval '5 minutes',
        updated_at = now()
    WHERE id = p_job_id;

    UPDATE public.pipeline_execution_items
    SET status = 'retry_wait',
        error_code = p_error_code,
        error_summary = p_error_summary,
        updated_at = now()
    WHERE job_id = p_job_id AND status NOT IN ('completed', 'failed');
  ELSE
    DECLARE
      v_exec_id uuid;
      v_downstream_types text[];
    BEGIN
      IF v_job.job_type = 'collection_2' THEN
        v_downstream_types := ARRAY['context_correction', 'memory_batch', 'daily_report'];
      ELSIF v_job.job_type = 'context_correction' THEN
        v_downstream_types := ARRAY['memory_batch', 'daily_report'];
      END IF;

      FOR v_exec_id IN 
        WITH updated AS (
          UPDATE public.pipeline_execution_items
          SET status = 'failed',
              outcome = 'FAILED',
              error_code = p_error_code,
              error_summary = p_error_summary,
              completed_at = now(),
              updated_at = now()
          WHERE job_id = p_job_id AND status NOT IN ('completed', 'failed')
          RETURNING execution_id
        )
        SELECT DISTINCT execution_id FROM updated
      LOOP
        IF v_downstream_types IS NOT NULL THEN
          UPDATE public.pipeline_execution_items
          SET status = 'failed',
              outcome = 'UPSTREAM_FAILED',
              error_code = p_error_code,
              error_summary = p_error_summary,
              completed_at = now(),
              updated_at = now()
          WHERE execution_id = v_exec_id
            AND child_id = v_job.child_id
            AND business_date = v_job.business_date
            AND job_type = ANY(v_downstream_types)
            AND status NOT IN ('completed', 'failed');
        END IF;
      END LOOP;

      UPDATE public.pipeline_jobs
      SET status = 'failed',
          last_error_code = p_error_code,
          last_error_summary = p_error_summary,
          completed_at = now(),
          updated_at = now()
      WHERE id = p_job_id;
    END;
  END IF;
END;
$$;


-- 10. Trigger for Collection Completion Propagation
CREATE OR REPLACE FUNCTION public.fn_trg_pipeline_jobs_collection_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exec RECORD;
  v_raw_count integer := 0;
BEGIN
  IF OLD.status = 'processing' AND NEW.status IN ('completed', 'failed') 
     AND NEW.job_type IN ('collection_1'::public.job_type_enum, 'collection_2'::public.job_type_enum) THEN
    
    UPDATE public.pipeline_execution_items
    SET status = NEW.status,
        outcome = CASE WHEN NEW.status = 'completed' THEN 'SUCCESS' ELSE 'FAILED' END,
        completed_at = CASE WHEN NEW.status IN ('completed', 'failed') THEN now() ELSE completed_at END,
        updated_at = now()
    WHERE job_id = NEW.id AND status NOT IN ('completed', 'failed');

    IF NEW.status = 'completed' AND NEW.job_type = 'collection_2'::public.job_type_enum THEN
      SELECT count(*)::integer INTO v_raw_count
      FROM public.raw_daily_conversation_messages_v3 m
      JOIN public.raw_daily_conversations_v3 c ON c.id = m.raw_daily_conversation_v3_id
      WHERE c.child_id = NEW.child_id AND c.business_date = NEW.business_date;

      IF v_raw_count > 0 THEN
        FOR v_exec IN 
          SELECT DISTINCT i.execution_id 
          FROM public.pipeline_execution_items i
          WHERE i.job_id = NEW.id
            AND EXISTS (
              SELECT 1 FROM public.pipeline_execution_items c_item
              WHERE c_item.execution_id = i.execution_id
                AND c_item.child_id = NEW.child_id
                AND c_item.job_type = 'context_correction'
                AND c_item.status NOT IN ('completed', 'failed')
            )
        LOOP
          PERFORM public.enqueue_context_correction_job_v3(NEW.child_id, NEW.business_date, v_exec.execution_id);
        END LOOP;
      ELSE
        UPDATE public.pipeline_execution_items
        SET status = 'completed',
            outcome = 'NO_CONVERSATION',
            completed_at = now(),
            updated_at = now()
        WHERE child_id = NEW.child_id 
          AND business_date = NEW.business_date 
          AND job_type IN ('context_correction', 'memory_batch', 'daily_report')
          AND status NOT IN ('completed', 'failed')
          AND execution_id IN (
            SELECT execution_id FROM public.pipeline_execution_items WHERE job_id = NEW.id
          );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pipeline_jobs_collection_complete ON public.pipeline_jobs;
CREATE TRIGGER trg_pipeline_jobs_collection_complete
  AFTER UPDATE OF status ON public.pipeline_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_trg_pipeline_jobs_collection_complete();


-- 11. Server-Authoritative Mission Expiry RPC
CREATE OR REPLACE FUNCTION public.force_end_mission_session_if_expired(
  p_session_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.chat_sessions%ROWTYPE;
  v_kst_started timestamptz;
  v_started_date date;
  v_round text := 'round1_day';
  v_cutoff timestamptz;
BEGIN
  SELECT * INTO v_session
  FROM public.chat_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND';
  END IF;

  IF v_session.session_type != 'mission' THEN
    RAISE EXCEPTION 'NOT_A_MISSION_SESSION';
  END IF;

  IF v_session.ended_at IS NOT NULL THEN
    RETURN 'ALREADY_ENDED';
  END IF;

  SELECT round_type INTO v_round
  FROM public.mission_progress
  WHERE session_id = p_session_id
  LIMIT 1;

  v_kst_started := v_session.started_at AT TIME ZONE 'Asia/Seoul';
  v_started_date := v_kst_started::date;

  IF v_round = 'round2_night' THEN
    v_cutoff := ((v_started_date + 1)::text || ' 00:00:00+09')::timestamptz;
  ELSE
    v_cutoff := (v_started_date::text || ' 17:50:00+09')::timestamptz;
  END IF;

  IF now() < v_cutoff THEN
    RETURN 'NOT_EXPIRED';
  END IF;

  UPDATE public.chat_sessions
  SET ended_at = now(),
      ended_reason = 'FORCE_ENDED'
  WHERE id = p_session_id;

  UPDATE public.mission_progress
  SET status = 'FORCE_ENDED',
      updated_at = now()
  WHERE session_id = p_session_id;

  RETURN 'FORCE_ENDED';
END;
$$;


-- 12. Security grants for SECURITY DEFINER RPCs (Explicit Signatures)
REVOKE ALL ON FUNCTION public.enqueue_pipeline_job_v3(text, uuid, date, uuid, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_pipeline_job_v3(text, uuid, date, uuid, integer, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_collection_jobs_v3(integer, date, uuid, uuid, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_collection_jobs_v3(integer, date, uuid, uuid, timestamptz, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_context_correction_job_v3(uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_context_correction_job_v3(uuid, date, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_memory_batch_job_v3(uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_memory_batch_job_v3(uuid, date, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_daily_report_job_v3(uuid, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_daily_report_job_v3(uuid, date, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.claim_collection_jobs_v3_for_execution(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_collection_jobs_v3_for_execution(uuid, text, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.claim_context_correction_jobs_v3_for_execution(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_context_correction_jobs_v3_for_execution(uuid, text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.claim_memory_batch_jobs_v3_for_execution(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_memory_batch_jobs_v3_for_execution(uuid, text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.claim_daily_report_jobs_v3_for_execution(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_report_jobs_v3_for_execution(uuid, text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.complete_context_correction_job_v3(uuid, text, uuid, uuid, date, text, text, integer, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_context_correction_job_v3(uuid, text, uuid, uuid, date, text, text, integer, integer, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.complete_memory_batch_job_v3(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_memory_batch_job_v3(uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.fail_memory_batch_job_v3(uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_memory_batch_job_v3(uuid, text, text, text, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.complete_daily_report_job_v3(uuid, text, uuid, date, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_daily_report_job_v3(uuid, text, uuid, date, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.mark_pipeline_job_failed_v3(uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_pipeline_job_failed_v3(uuid, text, text, text, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.force_end_mission_session_if_expired(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.force_end_mission_session_if_expired(uuid) TO service_role;



-- 10. Atomic Daily Report Persistence
CREATE OR REPLACE FUNCTION public.save_and_complete_daily_report_job_v3(
  p_job_id uuid,
  p_claimed_by text,
  p_child_id uuid,
  p_business_date date,
  p_report_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.pipeline_jobs%ROWTYPE;
  v_report_id uuid;
BEGIN
  -- 1) locks and validates
  SELECT * INTO v_job FROM public.pipeline_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_NOT_FOUND'; END IF;
  IF v_job.status != 'processing' OR v_job.claimed_by != p_claimed_by THEN RAISE EXCEPTION 'JOB_NOT_CLAIMED_BY_WORKER'; END IF;
  IF v_job.claim_expires_at < now() THEN RAISE EXCEPTION 'LEASE_EXPIRED'; END IF;
  IF v_job.child_id != p_child_id OR v_job.business_date != p_business_date THEN RAISE EXCEPTION 'JOB_MISMATCH'; END IF;

  -- 2) update or insert daily_reports
  SELECT id INTO v_report_id
  FROM public.daily_reports
  WHERE child_id = p_child_id AND business_date = p_business_date AND deleted_at IS NULL
  ORDER BY created_at DESC LIMIT 1;

  IF v_report_id IS NOT NULL THEN
    UPDATE public.daily_reports
    SET summary_line = p_report_payload->>'summary_line',
        mood_score = (p_report_payload->>'mood_score')::integer,
        emotion_tags = ARRAY(SELECT jsonb_array_elements_text(p_report_payload->'emotion_tags')),
        parent_guide = p_report_payload->>'parent_guide',
        emotion_level = COALESCE(p_report_payload->>'emotion_level', 'safe'),
        school_academy_life = p_report_payload->>'school_academy_life',
        peer_friendship = p_report_payload->>'peer_friendship',
        emotion_hint = p_report_payload->>'emotion_hint',
        interests_preferences = p_report_payload->>'interests_preferences',
        study_concerns = p_report_payload->>'study_concerns',
        digital_content_interests = p_report_payload->>'digital_content_interests',
        future_dreams = p_report_payload->>'future_dreams',
        recurring_stories = p_report_payload->>'recurring_stories'
    WHERE id = v_report_id;
  ELSE
    INSERT INTO public.daily_reports (
      child_id, business_date,
      summary_line, mood_score, emotion_tags, parent_guide, emotion_level,
      school_academy_life, peer_friendship, emotion_hint, interests_preferences,
      study_concerns, digital_content_interests, future_dreams, recurring_stories
    ) VALUES (
      p_child_id, p_business_date,
      p_report_payload->>'summary_line', COALESCE((p_report_payload->>'mood_score')::integer, 5), ARRAY(SELECT jsonb_array_elements_text(p_report_payload->'emotion_tags')), p_report_payload->>'parent_guide', COALESCE(p_report_payload->>'emotion_level', 'safe'),
      p_report_payload->>'school_academy_life', p_report_payload->>'peer_friendship', p_report_payload->>'emotion_hint', p_report_payload->>'interests_preferences',
      p_report_payload->>'study_concerns', p_report_payload->>'digital_content_interests', p_report_payload->>'future_dreams', p_report_payload->>'recurring_stories'
    ) RETURNING id INTO v_report_id;
  END IF;

  -- 3) update corrected report_generated_at
  UPDATE public.corrected_daily_conversations_v3
  SET report_generated_at = now()
  WHERE child_id = p_child_id AND business_date = p_business_date;

  -- 4) complete job and execution items
  UPDATE public.pipeline_jobs
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = p_job_id;

  UPDATE public.pipeline_execution_items
  SET status = 'completed', completed_at = now(), updated_at = now(), outcome = 'SUCCESS'
  WHERE job_id = p_job_id AND status NOT IN ('completed', 'failed');

  RETURN v_report_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_and_complete_daily_report_job_v3(uuid, text, uuid, date, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_and_complete_daily_report_job_v3(uuid, text, uuid, date, jsonb) TO service_role;

COMMIT;
