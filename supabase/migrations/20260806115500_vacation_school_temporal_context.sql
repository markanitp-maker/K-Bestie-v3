CREATE TABLE IF NOT EXISTS child_temporal_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  context_type TEXT NOT NULL,
  status TEXT NOT NULL,
  expected_school_start_date DATE,
  school_question_block_until DATE,
  confirmation_status TEXT,
  last_asked_business_date DATE,
  source_session_id UUID,
  source_message_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expired_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_child_temporal_context_active
  ON child_temporal_context(child_id, context_type)
  WHERE expired_at IS NULL;

ALTER TABLE child_temporal_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY "child_temporal_context_service_all"
  ON child_temporal_context FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON child_temporal_context TO anon, authenticated;

ALTER TABLE mission_questions ADD COLUMN IF NOT EXISTS school_context_tag TEXT;

UPDATE mission_questions SET school_context_tag = 'school_required' WHERE dashboard_area_tag = 'school_life';
UPDATE mission_questions SET school_context_tag = 'school_optional' WHERE dashboard_area_tag = 'study_concerns';
UPDATE mission_questions SET school_context_tag = 'universal' WHERE school_context_tag IS NULL;
