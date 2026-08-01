-- Forward fix: correct cm.child_id to cs.child_id
CREATE OR REPLACE FUNCTION public.collect_chat_messages_v3(
    p_job_id UUID,
    p_claimed_by TEXT,
    p_child_id UUID,
    p_business_date DATE,
    p_collection_phase INT,
    p_cutoff TIMESTAMPTZ,
    p_limit INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_v3_enabled BOOLEAN;
    v_cutover_at TIMESTAMPTZ;
    v_job_status public.job_status;
    v_job_claimed_by TEXT;
    v_raw_v3_id UUID;
    v_collected_count INT := 0;
    v_skipped_count INT := 0;
    v_mission_1 JSONB;
    v_free_chat_1 JSONB;
    v_mission_2 JSONB;
    v_free_chat_2 JSONB;
    msg RECORD;
    v_section TEXT;
    v_inserted_id UUID;
BEGIN
    IF auth.role() != 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF p_collection_phase NOT IN (1, 2) THEN
        RAISE EXCEPTION 'Invalid collection phase: %', p_collection_phase;
    END IF;

    -- 1. Check v3 Control
    SELECT enabled, cutover_at INTO v_v3_enabled, v_cutover_at 
    FROM public.pipeline_v3_control WHERE id = 1;
    
    IF NOT v_v3_enabled OR v_cutover_at IS NULL THEN
        RAISE EXCEPTION 'v3 pipeline is not enabled or cutover_at is null';
    END IF;

    -- 2. Validate and Lock Job
    SELECT status, claimed_by INTO v_job_status, v_job_claimed_by 
    FROM public.pipeline_jobs WHERE id = p_job_id FOR UPDATE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job % not found', p_job_id;
    END IF;
    IF v_job_status != 'claimed' OR v_job_claimed_by != p_claimed_by THEN
        RAISE EXCEPTION 'Job % is not properly claimed by %', p_job_id, p_claimed_by;
    END IF;

    -- 3. Upsert Parent Raw Row
    INSERT INTO public.raw_daily_conversations_v3 (child_id, business_date)
    VALUES (p_child_id, p_business_date)
    ON CONFLICT (child_id, business_date) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_raw_v3_id;

    -- 4. Process messages with FOR UPDATE SKIP LOCKED
    FOR msg IN (
        SELECT cm.id, cm.session_id, cs.session_type, cs.mission_phase, cm.role, cm.content, cm.created_at
        FROM public.chat_messages cm
        JOIN public.chat_sessions cs ON cm.session_id = cs.id
        WHERE cs.child_id = p_child_id
          AND cm.collected_at IS NULL
          AND cm.created_at >= v_cutover_at
          AND cm.created_at <= p_cutoff
        ORDER BY cm.created_at ASC
        LIMIT p_limit
        FOR UPDATE OF cm SKIP LOCKED
    ) LOOP
        -- Determine section
        IF msg.session_type = 'mission' THEN
            IF msg.mission_phase IS NULL THEN
                -- Rule: Skip and fail quietly, do not collect (or log without content)
                RAISE WARNING 'Skipping mission msg % due to NULL mission_phase', msg.id;
                v_skipped_count := v_skipped_count + 1;
                CONTINUE;
            END IF;
            -- We only collect mission_phase matching our collection_phase
            IF msg.mission_phase = 1 THEN v_section := 'mission_1';
            ELSIF msg.mission_phase = 2 THEN v_section := 'mission_2';
            END IF;
            
            -- If this job is for phase 1 but the message is phase 2, we leave it for the phase 2 job!
            -- Wait, if created_at <= cutoff, maybe it SHOULD be collected?
            -- Rule: "phase 1 작업은 mission_phase 1만 처리, phase 2 작업은 mission_phase 2만 처리"
            IF msg.mission_phase != p_collection_phase THEN
                -- Leave it uncollected so the proper phase job will pick it up
                CONTINUE;
            END IF;

        ELSIF msg.session_type = 'free_chat' THEN
            IF p_collection_phase = 1 THEN v_section := 'free_chat_1';
            ELSE v_section := 'free_chat_2';
            END IF;
        ELSE
            CONTINUE; -- Unknown session type
        END IF;

        -- Insert into normalized table
        INSERT INTO public.raw_daily_conversation_messages_v3 (
            raw_daily_conversation_v3_id, source_message_id, chat_message_fk,
            child_id, session_id, session_type, mission_phase, section, role,
            original_content, created_at, collection_job_id
        ) VALUES (
            v_raw_v3_id, msg.id, msg.id,
            p_child_id, msg.session_id, msg.session_type, msg.mission_phase, v_section, msg.role,
            msg.content, msg.created_at, p_job_id
        )
        ON CONFLICT (source_message_id) DO NOTHING
        RETURNING id INTO v_inserted_id;

        -- Mark as collected ONLY if we successfully inserted it
        IF v_inserted_id IS NOT NULL THEN
            UPDATE public.chat_messages 
            SET collected_at = now(), collection_batch_id = p_job_id
            WHERE id = msg.id;
            
            v_collected_count := v_collected_count + 1;
        END IF;
    END LOOP;

    -- 5. Rebuild JSONB arrays directly from normalized table
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', source_message_id, 'session_id', session_id, 'session_type', session_type,
        'mission_phase', mission_phase, 'role', role, 'content', original_content, 'created_at', created_at
    ) ORDER BY created_at ASC, source_message_id ASC), '[]'::jsonb) INTO v_mission_1
    FROM public.raw_daily_conversation_messages_v3 WHERE raw_daily_conversation_v3_id = v_raw_v3_id AND section = 'mission_1';

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', source_message_id, 'session_id', session_id, 'session_type', session_type,
        'mission_phase', mission_phase, 'role', role, 'content', original_content, 'created_at', created_at
    ) ORDER BY created_at ASC, source_message_id ASC), '[]'::jsonb) INTO v_free_chat_1
    FROM public.raw_daily_conversation_messages_v3 WHERE raw_daily_conversation_v3_id = v_raw_v3_id AND section = 'free_chat_1';

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', source_message_id, 'session_id', session_id, 'session_type', session_type,
        'mission_phase', mission_phase, 'role', role, 'content', original_content, 'created_at', created_at
    ) ORDER BY created_at ASC, source_message_id ASC), '[]'::jsonb) INTO v_mission_2
    FROM public.raw_daily_conversation_messages_v3 WHERE raw_daily_conversation_v3_id = v_raw_v3_id AND section = 'mission_2';

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', source_message_id, 'session_id', session_id, 'session_type', session_type,
        'mission_phase', mission_phase, 'role', role, 'content', original_content, 'created_at', created_at
    ) ORDER BY created_at ASC, source_message_id ASC), '[]'::jsonb) INTO v_free_chat_2
    FROM public.raw_daily_conversation_messages_v3 WHERE raw_daily_conversation_v3_id = v_raw_v3_id AND section = 'free_chat_2';

    -- 6. Update Parent Status
    UPDATE public.raw_daily_conversations_v3
    SET mission_1 = v_mission_1, free_chat_1 = v_free_chat_1, mission_2 = v_mission_2, free_chat_2 = v_free_chat_2,
        collection_1_status = CASE WHEN p_collection_phase = 1 THEN 'completed' ELSE collection_1_status END,
        collection_1_cutoff = CASE WHEN p_collection_phase = 1 THEN p_cutoff ELSE collection_1_cutoff END,
        collection_2_status = CASE WHEN p_collection_phase = 2 THEN 'completed' ELSE collection_2_status END,
        collection_2_cutoff = CASE WHEN p_collection_phase = 2 THEN p_cutoff ELSE collection_2_cutoff END,
        updated_at = now()
    WHERE id = v_raw_v3_id;

    -- 7. Complete Job
    UPDATE public.pipeline_jobs
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE id = p_job_id;

    RETURN jsonb_build_object(
        'raw_v3_id', v_raw_v3_id,
        'collected_count', v_collected_count,
        'skipped_count', v_skipped_count
    );
END;
$$;

-- Security Grants
REVOKE ALL ON FUNCTION public.collect_chat_messages_v3(UUID, TEXT, UUID, DATE, INT, TIMESTAMPTZ, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collect_chat_messages_v3(UUID, TEXT, UUID, DATE, INT, TIMESTAMPTZ, INT) TO service_role;
