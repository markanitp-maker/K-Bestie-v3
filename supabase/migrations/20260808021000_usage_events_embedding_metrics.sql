-- 073: Embeddings 성공 호출을 원문 없이 계측한다.
ALTER TABLE public.usage_events
  DROP CONSTRAINT IF EXISTS usage_events_kind_check;

ALTER TABLE public.usage_events
  ADD CONSTRAINT usage_events_kind_check
  CHECK (kind IN ('stt', 'tts', 'live_audio', 'llm', 'embedding'));

ALTER TABLE public.usage_events
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS request_count INTEGER,
  ADD COLUMN IF NOT EXISTS input_count INTEGER,
  ADD COLUMN IF NOT EXISTS environment TEXT;

ALTER TABLE public.usage_events
  DROP CONSTRAINT IF EXISTS usage_events_request_count_check,
  DROP CONSTRAINT IF EXISTS usage_events_input_count_check;

ALTER TABLE public.usage_events
  ADD CONSTRAINT usage_events_request_count_check CHECK (request_count IS NULL OR request_count >= 0),
  ADD CONSTRAINT usage_events_input_count_check CHECK (input_count IS NULL OR input_count >= 0);

CREATE INDEX IF NOT EXISTS idx_usage_events_kind_created
  ON public.usage_events(kind, created_at DESC);
