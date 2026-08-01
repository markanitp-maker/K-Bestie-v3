BEGIN;

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
  IF v_job.status != 'processing' THEN
    RAISE EXCEPTION 'JOB_NOT_PROCESSING';
  END IF;

  -- 2. control 검증
  SELECT * INTO v_control FROM public.pipeline_v3_control WHERE id = 1;
  IF NOT FOUND OR v_control.enabled = false THEN
    RAISE EXCEPTION 'V3_DISABLED';
  END IF;

  -- NULL mission_phase 검증
  IF EXISTS (
    SELECT 1 FROM public.chat_messages m
    JOIN public.chat_sessions s ON m.session_id = s.id
    WHERE s.child_id = v_job.child_id
      AND m.created_at <= v_job.cutoff_at
      AND m.created_at >= v_control.cutover_at
      AND m.collected_at IS NULL
      AND s.session_type = 'mission'
      AND s.mission_phase IS NULL
  ) THEN
    RAISE EXCEPTION 'MISSION_PHASE_REQUIRED';
  END IF;

  -- 5. Raw 컨테이너 생성 또는 잠금
  INSERT INTO public.raw_daily_conversations_v3 (child_id, business_date)
  VALUES (v_job.child_id, v_job.business_date)
  ON CONFLICT (child_id, business_date) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_raw_id;

  -- 3, 4, 6, 7, 8, 11
  FOR v_msg IN 
    SELECT m.*, s.child_id, s.session_type, s.mission_phase
    FROM public.chat_messages m
    JOIN public.chat_sessions s ON m.session_id = s.id
    WHERE s.child_id = v_job.child_id
      AND m.created_at <= v_job.cutoff_at
      AND m.created_at >= v_control.cutover_at
      AND m.collected_at IS NULL
      AND (
        (s.session_type = 'mission' AND (
            (v_job.collection_phase = 1 AND s.mission_phase = 1)
            OR
            (v_job.collection_phase = 2 AND s.mission_phase IN (1, 2))
        ))
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
    -- Section 분류 (session의 mission_phase 기준)
    IF v_msg.session_type = 'mission' THEN
      IF v_msg.mission_phase = 1 THEN 
        v_section := 'mission_1';
      ELSIF v_msg.mission_phase = 2 THEN 
        v_section := 'mission_2';
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
        created_at,
        collection_job_id
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
      SELECT COALESCE(jsonb_agg(row_to_json(msg)), '[]'::jsonb)
      FROM (
        SELECT session_id, role, original_content as content, created_at as created_at
        FROM public.raw_daily_conversation_messages_v3
        WHERE raw_daily_conversation_v3_id = v_raw_id AND section = 'mission_1'
        ORDER BY created_at ASC
      ) msg
    ),
    free_chat_1 = (
      SELECT COALESCE(jsonb_agg(row_to_json(msg)), '[]'::jsonb)
      FROM (
        SELECT session_id, role, original_content as content, created_at as created_at
        FROM public.raw_daily_conversation_messages_v3
        WHERE raw_daily_conversation_v3_id = v_raw_id AND section = 'free_chat_1'
        ORDER BY created_at ASC
      ) msg
    ),
    mission_2 = (
      SELECT COALESCE(jsonb_agg(row_to_json(msg)), '[]'::jsonb)
      FROM (
        SELECT session_id, role, original_content as content, created_at as created_at
        FROM public.raw_daily_conversation_messages_v3
        WHERE raw_daily_conversation_v3_id = v_raw_id AND section = 'mission_2'
        ORDER BY created_at ASC
      ) msg
    ),
    free_chat_2 = (
      SELECT COALESCE(jsonb_agg(row_to_json(msg)), '[]'::jsonb)
      FROM (
        SELECT session_id, role, original_content as content, created_at as created_at
        FROM public.raw_daily_conversation_messages_v3
        WHERE raw_daily_conversation_v3_id = v_raw_id AND section = 'free_chat_2'
        ORDER BY created_at ASC
      ) msg
    )
  WHERE id = v_raw_id;

  -- 12. Raw 상태·cutoff 갱신
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

COMMIT;
