-- 001/002-critical.md 백필 작업 중 발견: 2026-08-02 이전 일부 미션 세션은
-- mission_phase가 NULL이라(레거시 데이터, V3 mission_phase 트래킹 도입 이전),
-- collect_chat_messages_v3의 "NULL mission_phase validation" 가드가 항상
-- MISSION_PHASE_REQUIRED로 막는다. 안서아·안서현 2026-07-29~08-01 미션 대화가
-- 전부 이 케이스였다(자유대화는 이 기간 거의 없음 — 이 문제를 풀지 않으면
-- 사실상 복구 불가능).
--
-- 대표님 결정(2026-08-03): mission_phase가 없는 메시지는 자유대화 섹션과 동일한
-- 17:55 KST 기준으로 시간 유추 분류(mission_1/mission_2)한다.
--
-- claude-review 지적(2026-08-03) 반영: 최초 구현은 이 가드를 모든 아이·모든
-- 날짜에 대해 영구히 제거했는데, 이러면 앞으로 mission_phase 저장 로직에 새
-- 버그가 생겨도 조용히 시간 유추로 넘어가 아무도 알아채지 못한다. 대신
-- pipeline_v3_control에 legacy_mission_phase_before라는 고정 경계값을 새로 두고
-- (지금의 cutover_at 원래값 2026-08-01 20:46:53Z로 설정, 이후 이 컬럼은 변경하지
-- 않는다 — cutover_at처럼 백필을 위해 일시적으로 낮췄다 되돌리는 값이 아니다),
-- 이 경계 이전 메시지만 시간 유추를 허용하고 그 이후는 계속 하드 실패시킨다.

ALTER TABLE public.pipeline_v3_control
  ADD COLUMN IF NOT EXISTS legacy_mission_phase_before timestamptz;

UPDATE public.pipeline_v3_control
SET legacy_mission_phase_before = '2026-08-01T20:46:53.532819+00:00'::timestamptz
WHERE id = 1 AND legacy_mission_phase_before IS NULL;

CREATE OR REPLACE FUNCTION public.collect_chat_messages_v3(p_job_id uuid, p_claimed_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- NULL mission_phase validation — legacy_mission_phase_before 이전(레거시)
  -- 메시지만 예외로 허용(시간 유추로 아래에서 처리). 그 이후 메시지는 여전히
  -- 하드 실패시켜, 앞으로 mission_phase 저장에 새 버그가 생기면 조용히
  -- 넘어가지 않고 크게 걸리게 유지한다.
  IF EXISTS (
    SELECT 1 FROM public.chat_messages m
    JOIN public.chat_sessions s ON m.session_id = s.id
    WHERE s.child_id = v_job.child_id
      AND m.created_at < v_job.cutoff_at
      AND m.created_at >= v_control.cutover_at
      AND m.collected_at IS NULL
      AND s.session_type = 'mission'
      AND s.mission_phase IS NULL
      AND (v_control.legacy_mission_phase_before IS NULL OR m.created_at >= v_control.legacy_mission_phase_before)
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
            (v_job.collection_phase = 2 AND (
              s.mission_phase IN (1, 2)
              OR (s.mission_phase IS NULL AND (v_control.legacy_mission_phase_before IS NOT NULL AND m.created_at < v_control.legacy_mission_phase_before))
            ))
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
      ELSE
        -- mission_phase 없는 레거시 세션(위 가드/WHERE절 통과 = legacy_mission_phase_before
        -- 이전 메시지임이 보장됨) — 자유대화와 동일한 17:55 KST 기준으로 시간 유추
        IF v_msg.created_at <= (v_job.business_date::text || ' 17:55:00+09')::timestamptz THEN
          v_section := 'mission_1';
        ELSE
          v_section := 'mission_2';
        END IF;
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
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = v_job.id;

  -- Durable Context Correction enqueue inside DB transaction when Phase 2 completes
  IF v_job.collection_phase = 2 AND v_job.execution_id IS NOT NULL THEN
    PERFORM public.enqueue_context_correction_job_v3(v_job.child_id, v_job.business_date, v_job.execution_id);
  END IF;

  RETURN jsonb_build_object('inserted', v_inserted_count, 'collected', v_collected_count);
END;
$function$;
