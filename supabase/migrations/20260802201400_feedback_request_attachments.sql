-- Create feedback-attachments bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('feedback-attachments', 'feedback-attachments', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS feedback_request_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_request_id UUID REFERENCES support_requests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  upload_session_id TEXT,
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  original_filename TEXT,
  stored_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  width INTEGER,
  height INTEGER,
  display_order INTEGER NOT NULL,
  upload_status TEXT NOT NULL,
  checksum TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_feedback_request_attachments_request_id ON feedback_request_attachments(feedback_request_id);
CREATE INDEX IF NOT EXISTS idx_feedback_request_attachments_session_id ON feedback_request_attachments(upload_session_id);
CREATE INDEX IF NOT EXISTS idx_feedback_request_attachments_user_id ON feedback_request_attachments(user_id);

ALTER TABLE feedback_request_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_request_attachments_select" ON feedback_request_attachments;
CREATE POLICY "feedback_request_attachments_select"
  ON feedback_request_attachments FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "feedback_request_attachments_write_service_only" ON feedback_request_attachments;
CREATE POLICY "feedback_request_attachments_write_service_only" ON feedback_request_attachments FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');
