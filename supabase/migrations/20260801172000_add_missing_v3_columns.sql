BEGIN;
ALTER TABLE public.pipeline_jobs ADD COLUMN IF NOT EXISTS collection_phase integer;
ALTER TABLE public.pipeline_jobs ADD COLUMN IF NOT EXISTS cutoff_at timestamptz;
ALTER TABLE public.pipeline_jobs ADD COLUMN IF NOT EXISTS execution_id uuid;
ALTER TABLE public.pipeline_jobs ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz;
ALTER TABLE public.pipeline_jobs ADD COLUMN IF NOT EXISTS last_error_summary text;
ALTER TABLE public.pipeline_jobs ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3;

ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'processing';
ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'retry_wait';

-- Drop the unique constraint from idempotency_key if we need to, but it was already unique.
-- Wait, what about raw_daily_conversations_v3?
ALTER TABLE public.raw_daily_conversations_v3 ADD COLUMN IF NOT EXISTS collection_1_cutoff timestamptz;
ALTER TABLE public.raw_daily_conversations_v3 ADD COLUMN IF NOT EXISTS collection_2_cutoff timestamptz;

-- what about raw_daily_conversation_messages_v3?
ALTER TABLE public.raw_daily_conversation_messages_v3 ADD COLUMN IF NOT EXISTS mission_phase integer;
ALTER TABLE public.raw_daily_conversation_messages_v3 ADD COLUMN IF NOT EXISTS collection_job_id uuid;

COMMIT;
