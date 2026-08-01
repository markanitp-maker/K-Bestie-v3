BEGIN;

-- 1. Guarded Catalog Validation & Child Foreign Key Repair
ALTER TABLE IF EXISTS public.raw_daily_conversation_messages_v3 ADD COLUMN IF NOT EXISTS child_id uuid;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'raw_daily_conversation_messages_v3')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'raw_daily_conversations_v3') THEN
    EXECUTE '
      UPDATE public.raw_daily_conversation_messages_v3 m
      SET child_id = r.child_id
      FROM public.raw_daily_conversations_v3 r
      WHERE m.raw_daily_conversation_v3_id = r.id AND m.child_id IS NULL';
  END IF;
END $$;

DO $$
DECLARE
  v_invalid_count integer;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pipeline_jobs') THEN
    EXECUTE 'SELECT count(*) FROM public.pipeline_jobs WHERE child_id NOT IN (SELECT id FROM public.child_profiles)' INTO v_invalid_count;
    IF v_invalid_count > 0 THEN
      RAISE EXCEPTION 'INCOMPATIBLE_DATA: % invalid child_id entries in pipeline_jobs', v_invalid_count;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'raw_daily_conversations_v3') THEN
    EXECUTE 'SELECT count(*) FROM public.raw_daily_conversations_v3 WHERE child_id NOT IN (SELECT id FROM public.child_profiles)' INTO v_invalid_count;
    IF v_invalid_count > 0 THEN
      RAISE EXCEPTION 'INCOMPATIBLE_DATA: % invalid child_id entries in raw_daily_conversations_v3', v_invalid_count;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'raw_daily_conversation_messages_v3' AND column_name = 'child_id'
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.raw_daily_conversation_messages_v3 WHERE child_id IS NOT NULL AND child_id NOT IN (SELECT id FROM public.child_profiles)' INTO v_invalid_count;
    IF v_invalid_count > 0 THEN
      RAISE EXCEPTION 'INCOMPATIBLE_DATA: % invalid child_id entries in raw_daily_conversation_messages_v3', v_invalid_count;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'corrected_daily_conversations_v3') THEN
    EXECUTE 'SELECT count(*) FROM public.corrected_daily_conversations_v3 WHERE child_id NOT IN (SELECT id FROM public.child_profiles)' INTO v_invalid_count;
    IF v_invalid_count > 0 THEN
      RAISE EXCEPTION 'INCOMPATIBLE_DATA: % invalid child_id entries in corrected_daily_conversations_v3', v_invalid_count;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'corrected_daily_conversation_messages_v3') THEN
    EXECUTE 'SELECT count(*) FROM public.corrected_daily_conversation_messages_v3 WHERE child_id NOT IN (SELECT id FROM public.child_profiles)' INTO v_invalid_count;
    IF v_invalid_count > 0 THEN
      RAISE EXCEPTION 'INCOMPATIBLE_DATA: % invalid child_id entries in corrected_daily_conversation_messages_v3', v_invalid_count;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pipeline_jobs') THEN
    ALTER TABLE public.pipeline_jobs
      DROP CONSTRAINT IF EXISTS pipeline_jobs_child_id_fkey,
      ADD CONSTRAINT pipeline_jobs_child_id_fkey FOREIGN KEY (child_id) REFERENCES public.child_profiles(id) ON DELETE CASCADE;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'raw_daily_conversations_v3') THEN
    ALTER TABLE public.raw_daily_conversations_v3
      DROP CONSTRAINT IF EXISTS raw_daily_conversations_v3_child_id_fkey,
      ADD CONSTRAINT raw_daily_conversations_v3_child_id_fkey FOREIGN KEY (child_id) REFERENCES public.child_profiles(id) ON DELETE CASCADE;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'raw_daily_conversation_messages_v3') THEN
    ALTER TABLE public.raw_daily_conversation_messages_v3
      DROP CONSTRAINT IF EXISTS raw_daily_conversation_messages_v3_child_id_fkey,
      ADD CONSTRAINT raw_daily_conversation_messages_v3_child_id_fkey FOREIGN KEY (child_id) REFERENCES public.child_profiles(id) ON DELETE CASCADE;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'corrected_daily_conversations_v3') THEN
    ALTER TABLE public.corrected_daily_conversations_v3
      DROP CONSTRAINT IF EXISTS corrected_daily_conversations_v3_child_id_fkey,
      ADD CONSTRAINT corrected_daily_conversations_v3_child_id_fkey FOREIGN KEY (child_id) REFERENCES public.child_profiles(id) ON DELETE CASCADE;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'corrected_daily_conversation_messages_v3') THEN
    ALTER TABLE public.corrected_daily_conversation_messages_v3
      DROP CONSTRAINT IF EXISTS corrected_daily_conversation_messages_v3_child_id_fkey,
      ADD CONSTRAINT corrected_daily_conversation_messages_v3_child_id_fkey FOREIGN KEY (child_id) REFERENCES public.child_profiles(id) ON DELETE CASCADE;
  END IF;
END $$;


-- 2. Enqueue Collection Jobs V3 RPC Update
DROP FUNCTION IF EXISTS public.enqueue_collection_jobs_v3(integer, date, uuid);
DROP FUNCTION IF EXISTS public.enqueue_collection_jobs_v3(integer, date, uuid, uuid);

CREATE OR REPLACE FUNCTION public.enqueue_collection_jobs_v3(
  p_collection_phase integer,
  p_business_date date,
  p_execution_id uuid,
  p_child_id uuid DEFAULT NULL
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
  v_control public.pipeline_v3_control%ROWTYPE;
  v_cutoff_at timestamptz;
  v_enqueued_count integer := 0;
  v_existing_count integer := 0;
  v_candidate RECORD;
  v_existing_job public.pipeline_jobs%ROWTYPE;
BEGIN
  -- Input NULL checks
  IF p_business_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: business_date cannot be null';
  END IF;
  IF p_execution_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: execution_id cannot be null';
  END IF;

  -- 1. Control check
  SELECT * INTO v_control FROM public.pipeline_v3_control WHERE id = 1;
  IF NOT FOUND OR v_control.enabled = false THEN
    RAISE EXCEPTION 'V3_DISABLED';
  END IF;
  IF v_control.cutover_at IS NULL THEN
    RAISE EXCEPTION 'CUTOVER_AT_IS_NULL';
  END IF;

  -- 2. Phase check
  IF p_collection_phase NOT IN (1, 2) THEN
    RAISE EXCEPTION 'INVALID_PHASE';
  END IF;

  -- 3. Cutoff calculation: Phase 1 = 17:55 KST, Phase 2 = Next-day 00:00 KST
  IF p_collection_phase = 1 THEN
    v_cutoff_at := (p_business_date::text || ' 17:55:00+09')::timestamptz;
  ELSE
    v_cutoff_at := ((p_business_date + 1)::text || ' 00:00:00+09')::timestamptz;
  END IF;

  -- 4. Mission phase null check
  IF EXISTS (
    SELECT 1 FROM public.chat_messages m
    JOIN public.chat_sessions s ON m.session_id = s.id
    WHERE m.created_at >= (p_business_date::text || ' 00:00:00+09')::timestamptz
      AND m.created_at < v_cutoff_at
      AND m.created_at >= v_control.cutover_at
      AND m.collected_at IS NULL
      AND (p_child_id IS NULL OR s.child_id = p_child_id)
      AND s.session_type = 'mission'
      AND s.mission_phase IS NULL
  ) THEN
    RAISE EXCEPTION 'MISSION_PHASE_REQUIRED';
  END IF;

  -- Loop through children with uncollected messages matching cutoff & phase criteria
  FOR v_candidate IN
    SELECT DISTINCT s.child_id
    FROM public.chat_messages m
    JOIN public.chat_sessions s ON m.session_id = s.id
    WHERE m.created_at >= (p_business_date::text || ' 00:00:00+09')::timestamptz
      AND m.created_at < v_cutoff_at
      AND m.created_at >= v_control.cutover_at
      AND m.collected_at IS NULL
      AND (p_child_id IS NULL OR s.child_id = p_child_id)
      AND (
        (s.session_type = 'mission' AND (
            (p_collection_phase = 1 AND s.mission_phase = 1)
            OR
            (p_collection_phase = 2 AND s.mission_phase IN (1, 2))
        ))
        OR
        (s.session_type != 'mission')
      )
  LOOP
    SELECT * INTO v_existing_job
    FROM public.pipeline_jobs
    WHERE job_type = ('collection_' || p_collection_phase::text)::public.job_type_enum
      AND child_id = v_candidate.child_id
      AND business_date = p_business_date;

    IF NOT FOUND THEN
      INSERT INTO public.pipeline_jobs (
        job_type,
        child_id,
        business_date,
        collection_phase,
        cutoff_at,
        execution_id,
        status,
        idempotency_key
      ) VALUES (
        ('collection_' || p_collection_phase::text)::public.job_type_enum,
        v_candidate.child_id,
        p_business_date,
        p_collection_phase,
        v_cutoff_at,
        p_execution_id,
        'pending',
        'collection_' || v_candidate.child_id::text || '_' || p_business_date::text || '_' || p_collection_phase::text || '_' || extract(epoch from v_cutoff_at)::text
      );
      v_enqueued_count := v_enqueued_count + 1;
    ELSE
      IF v_existing_job.status IN ('completed', 'failed', 'retry_wait') THEN
        UPDATE public.pipeline_jobs
        SET status = 'pending',
            execution_id = p_execution_id,
            cutoff_at = v_cutoff_at,
            next_retry_at = now(),
            claimed_by = NULL,
            claimed_at = NULL,
            claim_expires_at = NULL,
            started_at = NULL,
            completed_at = NULL,
            last_error_code = NULL,
            last_error_summary = NULL,
            attempt_count = 0,
            updated_at = now()
        WHERE id = v_existing_job.id;
        v_enqueued_count := v_enqueued_count + 1;
      ELSE
        UPDATE public.pipeline_jobs
        SET execution_id = p_execution_id,
            updated_at = now()
        WHERE id = v_existing_job.id;
        v_existing_count := v_existing_count + 1;
      END IF;
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO v_existing_count
  FROM public.pipeline_jobs
  WHERE job_type = ('collection_' || p_collection_phase::text)::public.job_type_enum
    AND business_date = p_business_date
    AND status IN ('pending', 'processing');

  RETURN QUERY SELECT p_execution_id, v_cutoff_at, v_enqueued_count, v_existing_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_collection_jobs_v3(integer, date, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_collection_jobs_v3(integer, date, uuid, uuid) TO service_role;


-- 3. Claim Pipeline Jobs RPC Update (Batch worker claim, cutoff-enforced)
DROP FUNCTION IF EXISTS public.claim_pipeline_jobs(text, integer);
DROP FUNCTION IF EXISTS public.claim_pipeline_jobs(public.job_type_enum, integer, text, integer);
DROP FUNCTION IF EXISTS public.claim_pipeline_jobs(text, integer, integer);

CREATE OR REPLACE FUNCTION public.claim_pipeline_jobs(
  p_claimed_by text,
  p_limit integer,
  p_collection_phase integer
)
RETURNS SETOF public.pipeline_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'INVALID_LIMIT';
  END IF;

  IF p_collection_phase IS NULL OR p_collection_phase NOT IN (1, 2) THEN
    RAISE EXCEPTION 'INVALID_PHASE';
  END IF;

  RETURN QUERY
  WITH available AS (
    SELECT id
    FROM public.pipeline_jobs
    WHERE job_type = ('collection_' || p_collection_phase::text)::public.job_type_enum
      AND (status = 'pending' OR (status = 'retry_wait' AND next_retry_at <= now()) OR (status = 'processing' AND claim_expires_at <= now()))
      AND attempt_count < max_attempts
      AND cutoff_at <= now()
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

REVOKE EXECUTE ON FUNCTION public.claim_pipeline_jobs(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pipeline_jobs(text, integer, integer) TO service_role;


-- 4. Claim Specific Collection Job V3 RPC (Single-child / manual trigger claim, cutoff-enforced)
DROP FUNCTION IF EXISTS public.claim_specific_collection_job_v3(integer, uuid, date, text);

CREATE OR REPLACE FUNCTION public.claim_specific_collection_job_v3(
  p_collection_phase integer,
  p_child_id uuid,
  p_business_date date,
  p_claimed_by text
)
RETURNS SETOF public.pipeline_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_collection_phase IS NULL OR p_collection_phase NOT IN (1, 2) THEN
    RAISE EXCEPTION 'INVALID_PHASE';
  END IF;

  IF p_child_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CHILD_ID';
  END IF;

  IF p_business_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_BUSINESS_DATE';
  END IF;

  IF p_claimed_by IS NULL THEN
    RAISE EXCEPTION 'INVALID_CLAIMED_BY';
  END IF;

  RETURN QUERY
  WITH available AS (
    SELECT id
    FROM public.pipeline_jobs
    WHERE job_type = ('collection_' || p_collection_phase::text)::public.job_type_enum
      AND child_id = p_child_id
      AND business_date = p_business_date
      AND (
        status = 'pending' 
        OR (status = 'retry_wait' AND next_retry_at <= now()) 
        OR (status = 'processing' AND claim_expires_at <= now())
        OR (status = 'failed' AND attempt_count < max_attempts)
      )
      AND cutoff_at <= now()
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
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

REVOKE EXECUTE ON FUNCTION public.claim_specific_collection_job_v3(integer, uuid, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_specific_collection_job_v3(integer, uuid, date, text) TO service_role;


-- 5. Collect Chat Messages V3 RPC Update
CREATE OR REPLACE FUNCTION public.collect_chat_messages_v3(
  p_job_id uuid,
  p_claimed_by text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.pipeline_jobs%ROWTYPE;
  v_control public.pipeline_v3_control%ROWTYPE;
  v_raw_id uuid;
  v_msg RECORD;
  v_section text;
  v_inserted_count integer := 0;
  v_collected_count integer := 0;
  v_temp_seq integer := -1;
  v_min_seq integer;
  v_offset integer;
BEGIN
  -- 1. Job lock and status/lease verification
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
  IF v_job.status != 'processing' THEN
    RAISE EXCEPTION 'JOB_NOT_PROCESSING';
  END IF;

  -- 2. Control check
  SELECT * INTO v_control FROM public.pipeline_v3_control WHERE id = 1;
  IF NOT FOUND OR v_control.enabled = false THEN
    RAISE EXCEPTION 'V3_DISABLED';
  END IF;

  -- NULL mission_phase validation
  IF EXISTS (
    SELECT 1 FROM public.chat_messages m
    JOIN public.chat_sessions s ON m.session_id = s.id
    WHERE s.child_id = v_job.child_id
      AND m.created_at < v_job.cutoff_at
      AND m.created_at >= v_control.cutover_at
      AND m.collected_at IS NULL
      AND s.session_type = 'mission'
      AND s.mission_phase IS NULL
  ) THEN
    RAISE EXCEPTION 'MISSION_PHASE_REQUIRED';
  END IF;

  -- 3. Raw container creation or lock
  INSERT INTO public.raw_daily_conversations_v3 (child_id, business_date)
  VALUES (v_job.child_id, v_job.business_date)
  ON CONFLICT (child_id, business_date) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_raw_id;

  -- 4. Process uncollected messages
  FOR v_msg IN 
    SELECT m.*, s.child_id, s.session_type, s.mission_phase
    FROM public.chat_messages m
    JOIN public.chat_sessions s ON m.session_id = s.id
    WHERE s.child_id = v_job.child_id
      AND m.created_at >= (v_job.business_date::text || ' 00:00:00+09')::timestamptz
      AND m.created_at < v_job.cutoff_at
      AND m.created_at >= v_control.cutover_at
      AND m.collected_at IS NULL
      AND (
        (s.session_type = 'mission' AND (
            (v_job.collection_phase = 1 AND s.mission_phase = 1)
            OR
            (v_job.collection_phase = 2 AND s.mission_phase IN (1, 2))
        ))
        OR
        (s.session_type != 'mission')
      )
    ORDER BY m.created_at ASC, m.id ASC
    FOR UPDATE OF m
  LOOP
    -- Determine section
    IF v_msg.session_type = 'mission' THEN
      IF v_msg.mission_phase = 1 THEN 
        v_section := 'mission_1';
      ELSIF v_msg.mission_phase = 2 THEN 
        v_section := 'mission_2';
      END IF;
    ELSE
      IF v_msg.created_at <= (v_job.business_date::text || ' 17:55:00+09')::timestamptz THEN
        v_section := 'free_chat_1';
      ELSE
        v_section := 'free_chat_2';
      END IF;
    END IF;

    -- Normalized INSERT + Mark collected_at in single transaction
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
        created_at,
        collection_job_id,
        display_sequence
      ) VALUES (
        v_msg.id,
        v_raw_id,
        v_job.child_id,
        v_msg.session_id,
        v_msg.session_type,
        v_msg.mission_phase,
        v_section,
        v_msg.role,
        v_msg.content,
        v_msg.created_at,
        v_job.id,
        v_temp_seq
      );
      v_inserted_count := v_inserted_count + 1;
      v_temp_seq := v_temp_seq - 1;
      
      UPDATE public.chat_messages
      SET collected_at = now()
      WHERE id = v_msg.id;
      v_collected_count := v_collected_count + 1;
    EXCEPTION WHEN unique_violation THEN
      IF EXISTS (
        SELECT 1 FROM public.raw_daily_conversation_messages_v3
        WHERE source_message_id = v_msg.id
      ) THEN
        UPDATE public.chat_messages
        SET collected_at = now()
        WHERE id = v_msg.id AND collected_at IS NULL;
        v_collected_count := v_collected_count + 1;
      ELSE
        RAISE;
      END IF;
    END;
  END LOOP;

  -- Collision-safe re-sequencing via two-step update
  IF EXISTS (
    SELECT 1 FROM public.raw_daily_conversation_messages_v3
    WHERE raw_daily_conversation_v3_id = v_raw_id AND display_sequence < 0
  ) THEN
    SELECT COALESCE(MIN(display_sequence), 0) INTO v_min_seq
    FROM public.raw_daily_conversation_messages_v3
    WHERE raw_daily_conversation_v3_id = v_raw_id;

    v_offset := v_min_seq - 1000000;

    WITH numbered AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY raw_daily_conversation_v3_id 
               ORDER BY 
                 CASE section 
                   WHEN 'mission_1' THEN 1 
                   WHEN 'free_chat_1' THEN 2 
                   WHEN 'mission_2' THEN 3 
                   WHEN 'free_chat_2' THEN 4 
                   ELSE 5 
                 END,
                 created_at ASC,
                 source_message_id ASC,
                 id ASC
             ) as rn
      FROM public.raw_daily_conversation_messages_v3
      WHERE raw_daily_conversation_v3_id = v_raw_id
    )
    UPDATE public.raw_daily_conversation_messages_v3 m
    SET display_sequence = v_offset - n.rn
    FROM numbered n
    WHERE m.id = n.id;

    UPDATE public.raw_daily_conversation_messages_v3
    SET display_sequence = v_offset - display_sequence
    WHERE raw_daily_conversation_v3_id = v_raw_id
      AND display_sequence <= (v_offset - 1);
  END IF;

  -- Regenerate JSONB snapshots
  UPDATE public.raw_daily_conversations_v3
  SET 
    mission_1 = (
      SELECT COALESCE(jsonb_agg(row_to_json(msg)), '[]'::jsonb)
      FROM (
        SELECT id, source_message_id, session_id, role, original_content as content, created_at, display_sequence
        FROM public.raw_daily_conversation_messages_v3
        WHERE raw_daily_conversation_v3_id = v_raw_id AND section = 'mission_1'
        ORDER BY display_sequence ASC
      ) msg
    ),
    free_chat_1 = (
      SELECT COALESCE(jsonb_agg(row_to_json(msg)), '[]'::jsonb)
      FROM (
        SELECT id, source_message_id, session_id, role, original_content as content, created_at, display_sequence
        FROM public.raw_daily_conversation_messages_v3
        WHERE raw_daily_conversation_v3_id = v_raw_id AND section = 'free_chat_1'
        ORDER BY display_sequence ASC
      ) msg
    ),
    mission_2 = (
      SELECT COALESCE(jsonb_agg(row_to_json(msg)), '[]'::jsonb)
      FROM (
        SELECT id, source_message_id, session_id, role, original_content as content, created_at, display_sequence
        FROM public.raw_daily_conversation_messages_v3
        WHERE raw_daily_conversation_v3_id = v_raw_id AND section = 'mission_2'
        ORDER BY display_sequence ASC
      ) msg
    ),
    free_chat_2 = (
      SELECT COALESCE(jsonb_agg(row_to_json(msg)), '[]'::jsonb)
      FROM (
        SELECT id, source_message_id, session_id, role, original_content as content, created_at, display_sequence
        FROM public.raw_daily_conversation_messages_v3
        WHERE raw_daily_conversation_v3_id = v_raw_id AND section = 'free_chat_2'
        ORDER BY display_sequence ASC
      ) msg
    )
  WHERE id = v_raw_id;

  -- Update collection status and cutoff
  IF v_job.collection_phase = 1 THEN
    UPDATE public.raw_daily_conversations_v3
    SET collection_1_status = 'completed',
        collection_1_cutoff = v_job.cutoff_at,
        updated_at = now()
    WHERE id = v_raw_id;
  ELSE
    UPDATE public.raw_daily_conversations_v3
    SET collection_2_status = 'completed',
        collection_2_cutoff = v_job.cutoff_at,
        updated_at = now()
    WHERE id = v_raw_id;
  END IF;

  -- Mark job completed
  UPDATE public.pipeline_jobs
  SET status = 'completed',
      completed_at = now(),
      updated_at = now()
  WHERE id = v_job.id;

  -- Durable Context Correction enqueue inside DB transaction when Phase 2 completes
  IF v_job.collection_phase = 2 AND v_job.execution_id IS NOT NULL THEN
    PERFORM public.enqueue_context_correction_job_v3(v_job.child_id, v_job.business_date, v_job.execution_id);
  END IF;

  RETURN jsonb_build_object('inserted', v_inserted_count, 'collected', v_collected_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.collect_chat_messages_v3(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collect_chat_messages_v3(uuid, text) TO service_role;

COMMIT;
