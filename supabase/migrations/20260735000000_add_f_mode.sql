-- test_mode_overrides: allow 'F'
ALTER TABLE public.test_mode_overrides
  DROP CONSTRAINT IF EXISTS test_mode_overrides_conversation_mode_check;

ALTER TABLE public.test_mode_overrides
  ADD CONSTRAINT test_mode_overrides_conversation_mode_check
  CHECK (conversation_mode IN ('A','B','C','D','E','F'));

-- usage_events: allow 'F'
ALTER TABLE public.usage_events
  DROP CONSTRAINT IF EXISTS usage_events_conversation_mode_check;

ALTER TABLE public.usage_events
  ADD CONSTRAINT usage_events_conversation_mode_check
  CHECK (conversation_mode IS NULL OR conversation_mode IN ('A','B','C','D','E','F'));
