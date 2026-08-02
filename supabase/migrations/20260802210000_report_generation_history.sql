BEGIN;

ALTER TABLE public.pipeline_execution_items
  ADD COLUMN IF NOT EXISTS generation_source text,
  ADD COLUMN IF NOT EXISTS generation_version integer,
  ADD COLUMN IF NOT EXISTS model_version text,
  ADD COLUMN IF NOT EXISTS executor_id text,
  ADD COLUMN IF NOT EXISTS source_data_updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.save_and_complete_daily_report_job_v3(
  p_job_id uuid,
  p_claimed_by text,
  p_child_id uuid,
  p_business_date date,
  p_report_payload jsonb,
  p_generation_source text DEFAULT 'manual',
  p_source_data_updated_at timestamptz DEFAULT now(),
  p_model_version text DEFAULT NULL
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
  v_new_version integer;
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
     SET status = 'completed', completed_at = now(), updated_at = now(), outcome = 'SKIPPED_OLDER_DATA',
         generation_source = p_generation_source,
         generation_version = v_current_version,
         source_data_updated_at = p_source_data_updated_at,
         model_version = p_model_version,
         executor_id = p_claimed_by
     WHERE job_id = p_job_id AND status NOT IN ('completed', 'failed');

     RETURN v_report_id;
  END IF;

  IF v_report_id IS NOT NULL THEN
    v_new_version := COALESCE(v_current_version, 1) + 1;
    UPDATE public.daily_reports
    SET summary_line = p_report_payload->>'summary_line',
        mood_score = COALESCE((p_report_payload->>'mood_score')::integer, 5),
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
        generation_version = v_new_version,
        source_data_updated_at = p_source_data_updated_at
    WHERE id = v_report_id;
  ELSE
    v_new_version := 1;
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
      p_generation_source, v_new_version, p_source_data_updated_at
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
  SET status = 'completed', completed_at = now(), updated_at = now(), outcome = 'SUCCESS',
      generation_source = p_generation_source,
      generation_version = v_new_version,
      source_data_updated_at = p_source_data_updated_at,
      model_version = p_model_version,
      executor_id = p_claimed_by
  WHERE job_id = p_job_id AND status NOT IN ('completed', 'failed');

  RETURN v_report_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_and_complete_daily_report_job_v3(uuid, text, uuid, date, jsonb, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_and_complete_daily_report_job_v3(uuid, text, uuid, date, jsonb, text, timestamptz, text) TO service_role;

COMMIT;

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
        executor_id = p_claimed_by,
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
              executor_id = p_claimed_by,
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
              executor_id = p_claimed_by,
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
