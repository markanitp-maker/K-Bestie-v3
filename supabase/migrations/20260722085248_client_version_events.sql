CREATE TABLE IF NOT EXISTS client_version_events (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID,
  child_id UUID,
  client_sha TEXT,
  sw_version TEXT,
  deployment_id TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_version_events_session ON client_version_events(session_id);
GRANT ALL ON client_version_events TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE client_version_events_id_seq TO anon, authenticated;
