BEGIN;
SET CONSTRAINTS ALL DEFERRED;

-- 1. Create a dummy child and family
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-000000000001', 'test@example.com');
INSERT INTO public.families (id, name) VALUES ('00000000-0000-0000-0000-000000000002', 'test_family');
INSERT INTO public.child_profiles (id, family_id, name, grade) VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'testchild', '1학년');

-- 2. Create mock session and message
INSERT INTO public.chat_sessions (id, child_id, session_type, mission_phase)
VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'mission', 1);

INSERT INTO public.chat_messages (id, session_id, role, content, created_at)
VALUES ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000010', 'child', 'hello test', '2026-08-01 12:00:00Z');

-- 3. Enable v3 control
UPDATE public.pipeline_v3_control SET enabled = true, cutover_at = '2026-08-01 00:00:00Z' WHERE id = 1;

-- 4. Create and claim job
INSERT INTO public.pipeline_jobs (id, job_type, child_id, business_date, status, claimed_by, idempotency_key)
VALUES ('00000000-0000-0000-0000-000000001000', 'collection_1', '00000000-0000-0000-0000-000000000001', '2026-08-01', 'claimed', 'test-worker', 'test_key_123');

-- 5. Execute RPC
SELECT public.collect_chat_messages_v3(
    '00000000-0000-0000-0000-000000001000'::uuid,
    'test-worker'::text,
    '00000000-0000-0000-0000-000000000001'::uuid,
    '2026-08-01'::date,
    1::int,
    '2026-08-01 18:00:00Z'::timestamptz,
    100::int
) AS result;

-- 6. Verify result (collected_at is set)
SELECT id, collected_at, collection_batch_id FROM public.chat_messages WHERE id = '00000000-0000-0000-0000-000000000100';

-- 7. Verify JSONB
SELECT mission_1 FROM public.raw_daily_conversations_v3 WHERE child_id = '00000000-0000-0000-0000-000000000001';

-- Rollback EVERYTHING
ROLLBACK;
