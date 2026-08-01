-- Forward Fix: Revert unintended changes from 20260781000000_collection_pipeline_refactor.sql
-- The rule strictly forbids renaming/dropping legacy tables. We are restoring them to their original state.

-- 1. Drop the wrongly created new tables
DROP TABLE IF EXISTS public.corrected_daily_conversations CASCADE;
DROP TABLE IF EXISTS public.raw_daily_conversations CASCADE;

-- 2. Restore legacy tables by renaming them back
ALTER TABLE IF EXISTS public.corrected_daily_conversations_v1 RENAME TO corrected_daily_conversations;
ALTER TABLE IF EXISTS public.raw_daily_conversations_v1 RENAME TO raw_daily_conversations;

-- 3. Drop collected_at column from chat_messages so the phase 1 migration can cleanly add it
ALTER TABLE public.chat_messages DROP COLUMN IF EXISTS collected_at;
