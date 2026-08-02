-- 2026-08-03 Production 장애(requests/001-critical.md) 근본 수정:
-- enqueue_context_correction_job_v3가 "이 execution_id로 미리 스냅샷된
-- context_correction pipeline_execution_items 행이 이미 존재해야만" 다음
-- 단계를 Enqueue하는 조건을 갖고 있었다. 그런데 관리자 "즉시 대화 수집"
-- (action=collect)은 collection_2만 스냅샷하고 context_correction은 스냅샷하지
-- 않으므로, 이 가드가 항상 참(NOT EXISTS)이 되어 조용히 RETURN NULL — Collection
-- 완료 후 Context Correction이 영원히 생성되지 않았다(안서아 2026-08-02 재현
-- 확인: collection_2 completed인데 context_correction 잡 자체가 없음).
--
-- enqueue_memory_batch_job_v3 / enqueue_daily_report_job_v3에는 이런 가드가
-- 없다 — 항상 무조건 enqueue_pipeline_job_v3를 호출한다. enqueue_pipeline_job_v3
-- 자체가 이미 (existing job 재사용/재시도/이미완료 처리, execution_id당 중복 방지)
-- 멱등성을 전부 책임지고 있으므로, context_correction만 이 별도 가드를 추가로
-- 가질 이유가 없다. 가드를 제거해 "Collection 2 완료 → Context Correction
-- Enqueue"가 어떤 관리자 액션으로 시작됐든 항상 성립하게 한다.
--
-- enqueue_pipeline_job_v3의 collection_2-already-completed 재실행 분기에도
-- 동일한 형태의 중복 가드가 있어 같이 제거한다(대표님이 이미 완료된 날짜에
-- collect_and_generate를 다시 눌러도 동일하게 막히던 경로).

CREATE OR REPLACE FUNCTION public.enqueue_context_correction_job_v3(p_child_id uuid, p_business_date date, p_execution_id uuid)
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

-- enqueue_pipeline_job_v3의 collection_2 already-completed 재실행 분기에서도
-- 동일한 사전 스냅샷 존재 가드를 제거하고 항상 enqueue_context_correction_job_v3를
-- 호출하게 한다(그 함수 내부의 멱등성 로직이 중복/이미완료 처리를 담당).
CREATE OR REPLACE FUNCTION public.enqueue_pipeline_job_v3(p_job_type text, p_child_id uuid, p_business_date date, p_execution_id uuid, p_collection_phase integer DEFAULT NULL::integer, p_cutoff_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
                PERFORM public.enqueue_context_correction_job_v3(p_child_id, p_business_date, p_execution_id);
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
$function$;
