BEGIN;

-- 1. Add column if not exists
ALTER TABLE public.raw_daily_conversation_messages_v3 
ADD COLUMN IF NOT EXISTS display_sequence integer;

-- 2. Backfill existing data
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
)
UPDATE public.raw_daily_conversation_messages_v3 m
SET display_sequence = n.rn
FROM numbered n
WHERE m.id = n.id;

-- 3. Make column NOT NULL
ALTER TABLE public.raw_daily_conversation_messages_v3 
ALTER COLUMN display_sequence SET NOT NULL;

-- 4. Add index
CREATE INDEX IF NOT EXISTS idx_raw_msgs_v3_display_seq 
ON public.raw_daily_conversation_messages_v3 (raw_daily_conversation_v3_id, display_sequence);

-- 5. Add unique constraint safely
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'raw_msgs_v3_display_seq_unique'
      AND table_name = 'raw_daily_conversation_messages_v3'
  ) THEN
    ALTER TABLE public.raw_daily_conversation_messages_v3 
    ADD CONSTRAINT raw_msgs_v3_display_seq_unique 
    UNIQUE (raw_daily_conversation_v3_id, display_sequence);
  END IF;
END $$;

-- 6. Update collect_chat_messages_v3
CREATE OR REPLACE FUNCTION public.collect_chat_messages_v3(p_job_id uuid, p_claimed_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

  -- 3. NULL mission_phase validation
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

  -- 4. Raw container creation or lock
  INSERT INTO public.raw_daily_conversations_v3 (child_id, business_date)
  VALUES (v_job.child_id, v_job.business_date)
  ON CONFLICT (child_id, business_date) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_raw_id;

  FOR v_msg IN 
    SELECT m.*, s.child_id, s.session_type, s.mission_phase
    FROM public.chat_messages m
    JOIN public.chat_sessions s ON m.session_id = s.id
    WHERE s.child_id = v_job.child_id
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
        (s.session_type != 'mission' AND (
           (v_job.collection_phase = 1 AND m.created_at > ((v_job.business_date - 1)::text || ' 23:55:00+09')::timestamptz AND m.created_at < v_job.cutoff_at)
           OR
           (v_job.collection_phase = 2 AND m.created_at > (v_job.business_date::text || ' 17:55:00+09')::timestamptz AND m.created_at < v_job.cutoff_at)
        ))
      )
    ORDER BY m.created_at ASC, m.id ASC
    FOR UPDATE OF m
  LOOP
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
      NULL;
    END;
  END LOOP;

  IF v_inserted_count > 0 THEN
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
    SET display_sequence = n.rn
    FROM numbered n
    WHERE m.id = n.id AND (m.display_sequence IS NULL OR m.display_sequence != n.rn);
  END IF;

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

  UPDATE public.pipeline_jobs
  SET status = 'completed',
      completed_at = now(),
      updated_at = now()
  WHERE id = v_job.id;

  RETURN jsonb_build_object('inserted', v_inserted_count, 'collected', v_collected_count);
END;
$function$;

COMMIT;
