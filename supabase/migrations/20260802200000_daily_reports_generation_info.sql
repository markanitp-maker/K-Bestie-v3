BEGIN;

ALTER TABLE public.daily_reports
  ADD COLUMN IF NOT EXISTS generation_source text,
  ADD COLUMN IF NOT EXISTS generation_version integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source_data_updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.save_and_complete_daily_report_job_v3(
  p_job_id uuid,
  p_claimed_by text,
  p_child_id uuid,
  p_business_date date,
  p_report_payload jsonb,
  p_generation_source text DEFAULT 'manual',
  p_source_data_updated_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.pipeline_jobs%ROWTYPE;
  v_report_id uuid;
  v_current_version integer;
  v_current_source_updated timestamptz;
BEGIN
  -- 1) locks and validates
  SELECT * INTO v_job FROM public.pipeline_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_NOT_FOUND'; END IF;
  IF v_job.status != 'processing' OR v_job.claimed_by != p_claimed_by THEN RAISE EXCEPTION 'JOB_NOT_CLAIMED_BY_WORKER'; END IF;
  IF v_job.claim_expires_at < now() THEN RAISE EXCEPTION 'LEASE_EXPIRED'; END IF;
  IF v_job.child_id != p_child_id OR v_job.business_date != p_business_date THEN RAISE EXCEPTION 'JOB_MISMATCH'; END IF;

  -- 2) update or insert daily_reports
  SELECT id, generation_version, source_data_updated_at INTO v_report_id, v_current_version, v_current_source_updated
  FROM public.daily_reports
  WHERE child_id = p_child_id AND business_date = p_business_date AND deleted_at IS NULL
  ORDER BY created_at DESC LIMIT 1;

  -- Check rule: do not overwrite if new data is older than current data
  IF v_report_id IS NOT NULL AND v_current_source_updated IS NOT NULL AND p_source_data_updated_at < v_current_source_updated THEN
     -- Skip update, but complete the job
     -- 3) update corrected report_generated_at
     UPDATE public.corrected_daily_conversations_v3
     SET report_generated_at = now()
     WHERE child_id = p_child_id AND business_date = p_business_date;

     -- 4) complete job and execution items
     UPDATE public.pipeline_jobs
     SET status = 'completed', completed_at = now(), updated_at = now()
     WHERE id = p_job_id;

     UPDATE public.pipeline_execution_items
     SET status = 'completed', completed_at = now(), updated_at = now(), outcome = 'SKIPPED_OLDER_DATA'
     WHERE job_id = p_job_id AND status NOT IN ('completed', 'failed');

     RETURN v_report_id;
  END IF;

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
        recurring_stories = p_report_payload->>'recurring_stories',
        generation_source = p_generation_source,
        generation_version = COALESCE(v_current_version, 1) + 1,
        source_data_updated_at = p_source_data_updated_at
    WHERE id = v_report_id;
  ELSE
    INSERT INTO public.daily_reports (
      child_id, business_date,
      summary_line, mood_score, emotion_tags, parent_guide, emotion_level,
      school_academy_life, peer_friendship, emotion_hint, interests_preferences,
      study_concerns, digital_content_interests, future_dreams, recurring_stories,
      generation_source, generation_version, source_data_updated_at
    ) VALUES (
      p_child_id, p_business_date,
      p_report_payload->>'summary_line', COALESCE((p_report_payload->>'mood_score')::integer, 5), ARRAY(SELECT jsonb_array_elements_text(p_report_payload->'emotion_tags')), p_report_payload->>'parent_guide', COALESCE(p_report_payload->>'emotion_level', 'safe'),
      p_report_payload->>'school_academy_life', p_report_payload->>'peer_friendship', p_report_payload->>'emotion_hint', p_report_payload->>'interests_preferences',
      p_report_payload->>'study_concerns', p_report_payload->>'digital_content_interests', p_report_payload->>'future_dreams', p_report_payload->>'recurring_stories',
      p_generation_source, 1, p_source_data_updated_at
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
REVOKE ALL ON FUNCTION public.save_and_complete_daily_report_job_v3(uuid, text, uuid, date, jsonb, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_and_complete_daily_report_job_v3(uuid, text, uuid, date, jsonb, text, timestamptz) TO service_role;

COMMIT;

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
    -- Prevent duplicate runs within same execution ID
    IF EXISTS (
      SELECT 1 FROM public.pipeline_execution_items 
      WHERE execution_id = p_execution_id 
        AND job_id = v_job_id
        AND status IN ('pending', 'processing', 'completed', 'failed')
    ) THEN
      RETURN v_job_id;
    END IF;

    IF v_job_status = 'completed' THEN
      DECLARE
        v_uncollected integer := 0;
        v_should_reset boolean := false;
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
          IF v_uncollected > 0 THEN v_should_reset := true; END IF;
        ELSE
          -- Allow manual regeneration of reports/memories/corrections
          v_should_reset := true;
        END IF;

        IF v_should_reset THEN
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
