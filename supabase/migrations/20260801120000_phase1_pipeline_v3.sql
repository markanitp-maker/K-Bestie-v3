-- Additive Migration: v3 Pipeline Tables
-- This migration creates isolated v3 tables for the new data pipeline (Collection, Correction)
-- and does NOT alter existing legacy tables (raw_daily_conversations, corrected_daily_conversations).

-- 0. Add mission_phase to chat_sessions
-- Only 1 or 2 allowed for missions. NULL allowed for free_chat.
ALTER TABLE public.chat_sessions
    ADD COLUMN mission_phase INT CHECK (mission_phase IN (1, 2));

-- 1. Create pipeline_jobs (Created first because chat_messages will reference it)
CREATE TYPE public.job_status AS ENUM ('pending', 'claimed', 'completed', 'failed');
CREATE TYPE public.job_type_enum AS ENUM ('collection_1', 'collection_2', 'context_correction', 'memory_batch', 'daily_report', 'cleanup', 'retention');

CREATE TABLE public.pipeline_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type public.job_type_enum NOT NULL,
    child_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    business_date DATE NOT NULL,
    source_record_id UUID,
    status public.job_status NOT NULL DEFAULT 'pending',
    attempt_count INT NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at TIMESTAMPTZ,
    claimed_by TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    last_error_code TEXT,
    idempotency_key TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_pipeline_jobs_unique_task 
ON public.pipeline_jobs (job_type, child_id, business_date);

CREATE INDEX idx_pipeline_jobs_claimable 
ON public.pipeline_jobs (next_retry_at ASC, created_at ASC) 
WHERE status IN ('pending', 'failed');

ALTER TABLE public.pipeline_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_pipeline" ON public.pipeline_jobs 
    FOR ALL USING (auth.role() = 'service_role');
GRANT ALL ON public.pipeline_jobs TO anon, authenticated;

-- 2. Create v3 Raw Daily Conversations (Snapshot of 4 areas)
CREATE TABLE public.raw_daily_conversations_v3 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    business_date DATE NOT NULL,
    mission_1 JSONB NOT NULL DEFAULT '[]'::jsonb,
    free_chat_1 JSONB NOT NULL DEFAULT '[]'::jsonb,
    mission_2 JSONB NOT NULL DEFAULT '[]'::jsonb,
    free_chat_2 JSONB NOT NULL DEFAULT '[]'::jsonb,
    collection_1_status TEXT NOT NULL DEFAULT 'pending' CHECK (collection_1_status IN ('pending', 'completed', 'failed')),
    collection_2_status TEXT NOT NULL DEFAULT 'pending' CHECK (collection_2_status IN ('pending', 'completed', 'failed')),
    collection_1_cutoff TIMESTAMPTZ,
    collection_2_cutoff TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(child_id, business_date)
);

CREATE INDEX idx_raw_v3_child_date ON public.raw_daily_conversations_v3(child_id, business_date);

ALTER TABLE public.raw_daily_conversations_v3 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_raw_v3" ON public.raw_daily_conversations_v3 
    FOR ALL USING (auth.role() = 'service_role');
GRANT ALL ON public.raw_daily_conversations_v3 TO anon, authenticated;

-- 3. Create v3 Normalized Raw Messages (Source of Truth for Integrity)
CREATE TABLE public.raw_daily_conversation_messages_v3 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_daily_conversation_v3_id UUID NOT NULL REFERENCES public.raw_daily_conversations_v3(id) ON DELETE CASCADE,
    source_message_id UUID NOT NULL UNIQUE, -- 불변 원본 ID 보존 (chat_messages가 지워져도 남음)
    chat_message_fk UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL, -- 관계성 추적용
    child_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    session_type TEXT NOT NULL CHECK (session_type IN ('mission', 'free_chat')),
    mission_phase INT CHECK (mission_phase IN (1, 2)),
    section TEXT NOT NULL CHECK (section IN ('mission_1', 'free_chat_1', 'mission_2', 'free_chat_2')),
    role TEXT NOT NULL CHECK (role IN ('child', 'k')),
    original_content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    collection_job_id UUID REFERENCES public.pipeline_jobs(id) ON DELETE SET NULL,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_raw_msgs_v3_parent ON public.raw_daily_conversation_messages_v3(raw_daily_conversation_v3_id);

ALTER TABLE public.raw_daily_conversation_messages_v3 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_raw_msgs_v3" ON public.raw_daily_conversation_messages_v3 
    FOR ALL USING (auth.role() = 'service_role');
GRANT ALL ON public.raw_daily_conversation_messages_v3 TO anon, authenticated;

-- 4. Create v3 Corrected Daily Conversations
CREATE TABLE public.corrected_daily_conversations_v3 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_daily_conversation_v3_id UUID NOT NULL REFERENCES public.raw_daily_conversations_v3(id) ON DELETE CASCADE,
    child_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    business_date DATE NOT NULL,
    mission_1 JSONB NOT NULL DEFAULT '[]'::jsonb,
    free_chat_1 JSONB NOT NULL DEFAULT '[]'::jsonb,
    mission_2 JSONB NOT NULL DEFAULT '[]'::jsonb,
    free_chat_2 JSONB NOT NULL DEFAULT '[]'::jsonb,
    correction_status TEXT NOT NULL DEFAULT 'pending' CHECK (correction_status IN ('pending', 'processing', 'completed', 'failed')),
    attempt_count INT NOT NULL DEFAULT 0,
    last_error_code TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(child_id, business_date)
);

CREATE INDEX idx_corrected_v3_child_date ON public.corrected_daily_conversations_v3(child_id, business_date);
CREATE INDEX idx_corrected_v3_status ON public.corrected_daily_conversations_v3(correction_status);

ALTER TABLE public.corrected_daily_conversations_v3 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_corrected_v3" ON public.corrected_daily_conversations_v3 
    FOR ALL USING (auth.role() = 'service_role');
GRANT ALL ON public.corrected_daily_conversations_v3 TO anon, authenticated;

-- 5. chat_messages Modifications (Additive)
-- collection_batch_id references pipeline_jobs. If a job is deleted, we SET NULL to preserve the message but clear the tracking.
ALTER TABLE public.chat_messages
    ADD COLUMN collected_at TIMESTAMPTZ,
    ADD COLUMN collection_batch_id UUID REFERENCES public.pipeline_jobs(id) ON DELETE SET NULL;

CREATE INDEX idx_chat_messages_uncollected 
ON public.chat_messages (created_at) 
WHERE collected_at IS NULL;

-- 6. Worker Claim RPC with FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_pipeline_jobs(
    p_job_type public.job_type_enum,
    p_limit INT,
    p_claimed_by TEXT,
    p_lease_minutes INT
)
RETURNS SETOF public.pipeline_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.role() != 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    -- Recover orphaned/expired leases
    UPDATE public.pipeline_jobs
    SET status = 'pending'
    WHERE status = 'claimed'
      AND job_type = p_job_type
      AND claimed_at < (now() - (p_lease_minutes || ' minutes')::interval);

    -- Claim jobs
    RETURN QUERY
    WITH claimed AS (
        SELECT pj.id
        FROM public.pipeline_jobs pj
        WHERE pj.job_type = p_job_type
          AND pj.status IN ('pending', 'failed')
          AND pj.next_retry_at <= now()
        ORDER BY pj.next_retry_at ASC, pj.created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT p_limit
    )
    UPDATE public.pipeline_jobs target
    SET status = 'claimed',
        claimed_at = now(),
        claimed_by = p_claimed_by,
        attempt_count = target.attempt_count + 1
    FROM claimed
    WHERE target.id = claimed.id
    RETURNING target.*;
END;
$$;

-- Security: Prevent external execution
REVOKE ALL ON FUNCTION public.claim_pipeline_jobs(public.job_type_enum, INT, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pipeline_jobs(public.job_type_enum, INT, TEXT, INT) TO service_role;

-- 7. Collection Merge RPC (Atomicity & Deduplication)
CREATE OR REPLACE FUNCTION public.merge_raw_collection_batch(
    p_job_id UUID,
    p_child_id UUID,
    p_business_date DATE,
    p_messages JSONB -- Array of JSON objects
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_raw_v3_id UUID;
    v_inserted_count INT;
    v_updated_msg_count INT;
    v_mission_1 JSONB;
    v_free_chat_1 JSONB;
    v_mission_2 JSONB;
    v_free_chat_2 JSONB;
    v_job_status public.job_status;
BEGIN
    -- Ensure caller is service_role
    IF auth.role() != 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    -- Validate job exists and is claimed
    SELECT status INTO v_job_status FROM public.pipeline_jobs WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job % not found', p_job_id;
    END IF;
    IF v_job_status != 'claimed' THEN
        RAISE EXCEPTION 'Job % is not in claimed state (current: %)', p_job_id, v_job_status;
    END IF;

    -- Upsert raw_daily_conversations_v3 to ensure parent exists
    INSERT INTO public.raw_daily_conversations_v3 (child_id, business_date)
    VALUES (p_child_id, p_business_date)
    ON CONFLICT (child_id, business_date) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_raw_v3_id;

    -- Insert into normalized table
    -- Using jsonb_array_elements to unpack and insert
    WITH new_msgs AS (
        SELECT 
            (m->>'id')::UUID AS source_message_id,
            (m->>'id')::UUID AS chat_message_fk,
            p_child_id AS child_id,
            (m->>'session_id')::UUID AS session_id,
            (m->>'session_type') AS session_type,
            (m->>'mission_phase')::INT AS mission_phase,
            (m->>'section') AS section,
            (m->>'role') AS role,
            (m->>'original_content') AS original_content,
            (m->>'created_at')::TIMESTAMPTZ AS created_at
        FROM jsonb_array_elements(p_messages) AS m
    ),
    inserted AS (
        INSERT INTO public.raw_daily_conversation_messages_v3 (
            raw_daily_conversation_v3_id, source_message_id, chat_message_fk,
            child_id, session_id, session_type, mission_phase, section, role,
            original_content, created_at, collection_job_id
        )
        SELECT 
            v_raw_v3_id, source_message_id, chat_message_fk,
            child_id, session_id, session_type, mission_phase, section, role,
            original_content, created_at, p_job_id
        FROM new_msgs
        ON CONFLICT (source_message_id) DO NOTHING
        RETURNING id
    )
    SELECT count(*) INTO v_inserted_count FROM inserted;

    -- Rebuild JSONB arrays directly from normalized table using ORDER BY created_at ASC
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', source_message_id,
            'session_id', session_id,
            'session_type', session_type,
            'mission_phase', mission_phase,
            'role', role,
            'content', original_content,
            'created_at', created_at
        ) ORDER BY created_at ASC
    ), '[]'::jsonb)
    INTO v_mission_1
    FROM public.raw_daily_conversation_messages_v3
    WHERE raw_daily_conversation_v3_id = v_raw_v3_id AND section = 'mission_1';

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', source_message_id,
            'session_id', session_id,
            'session_type', session_type,
            'mission_phase', mission_phase,
            'role', role,
            'content', original_content,
            'created_at', created_at
        ) ORDER BY created_at ASC
    ), '[]'::jsonb)
    INTO v_free_chat_1
    FROM public.raw_daily_conversation_messages_v3
    WHERE raw_daily_conversation_v3_id = v_raw_v3_id AND section = 'free_chat_1';

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', source_message_id,
            'session_id', session_id,
            'session_type', session_type,
            'mission_phase', mission_phase,
            'role', role,
            'content', original_content,
            'created_at', created_at
        ) ORDER BY created_at ASC
    ), '[]'::jsonb)
    INTO v_mission_2
    FROM public.raw_daily_conversation_messages_v3
    WHERE raw_daily_conversation_v3_id = v_raw_v3_id AND section = 'mission_2';

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', source_message_id,
            'session_id', session_id,
            'session_type', session_type,
            'mission_phase', mission_phase,
            'role', role,
            'content', original_content,
            'created_at', created_at
        ) ORDER BY created_at ASC
    ), '[]'::jsonb)
    INTO v_free_chat_2
    FROM public.raw_daily_conversation_messages_v3
    WHERE raw_daily_conversation_v3_id = v_raw_v3_id AND section = 'free_chat_2';

    -- Update parent table
    UPDATE public.raw_daily_conversations_v3
    SET mission_1 = v_mission_1,
        free_chat_1 = v_free_chat_1,
        mission_2 = v_mission_2,
        free_chat_2 = v_free_chat_2,
        updated_at = now()
    WHERE id = v_raw_v3_id;

    -- Update chat_messages
    WITH parsed_ids AS (
        SELECT (m->>'id')::UUID AS msg_id FROM jsonb_array_elements(p_messages) AS m
    ),
    updated_msgs AS (
        UPDATE public.chat_messages cm
        SET collected_at = now(),
            collection_batch_id = p_job_id
        FROM parsed_ids
        WHERE cm.id = parsed_ids.msg_id
          AND cm.collected_at IS NULL
        RETURNING cm.id
    )
    SELECT count(*) INTO v_updated_msg_count FROM updated_msgs;

    -- Mark job as completed
    UPDATE public.pipeline_jobs
    SET status = 'completed',
        completed_at = now(),
        updated_at = now()
    WHERE id = p_job_id;

    RETURN jsonb_build_object(
        'inserted_normalized_count', v_inserted_count,
        'updated_chat_messages_count', v_updated_msg_count,
        'raw_v3_id', v_raw_v3_id
    );
END;
$$;

-- Security: Prevent external execution
REVOKE ALL ON FUNCTION public.merge_raw_collection_batch(UUID, UUID, DATE, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_raw_collection_batch(UUID, UUID, DATE, JSONB) TO service_role;
