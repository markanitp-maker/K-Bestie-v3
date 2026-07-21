CREATE TABLE IF NOT EXISTS turn_timing_events (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL,
  turn_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_turn_timing_events_session_turn ON turn_timing_events(session_id, turn_id);
GRANT ALL ON turn_timing_events TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE turn_timing_events_id_seq TO anon, authenticated;
