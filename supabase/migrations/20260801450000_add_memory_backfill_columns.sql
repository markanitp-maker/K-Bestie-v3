-- add pipeline_version, idempotency_key, backfill_status to memory_facts
ALTER TABLE public.memory_facts
ADD COLUMN IF NOT EXISTS pipeline_version TEXT,
ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
ADD COLUMN IF NOT EXISTS backfill_status TEXT;

-- idempotency_key should be unique for memory_facts to prevent duplicate generation for the same batch job/entity
CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_facts_idempotency_key
ON public.memory_facts(idempotency_key)
WHERE idempotency_key IS NOT NULL;
