-- 1. parent_question_quota 테이블 신설 (주기 카운터)
CREATE TABLE parent_question_quota (
  child_id UUID PRIMARY KEY REFERENCES child_profiles(id) ON DELETE CASCADE,
  daily_used_at TIMESTAMPTZ,
  weekly_used_count INTEGER NOT NULL DEFAULT 0,
  weekly_reset_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE parent_question_quota ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parent_question_quota_access"
  ON parent_question_quota FOR ALL
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = parent_question_quota.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = parent_question_quota.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );

GRANT ALL ON public.parent_question_quota TO anon, authenticated;

-- 2. parent_questions 권한 부여 (존재하지 않을 경우를 대비해 멱등하게 실행)
GRANT ALL ON public.parent_questions TO anon, authenticated;

-- 3. parent_questions 테이블의 기존 status CHECK 제약조건 제거 및 재생성
DO $$ 
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'parent_questions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE 'ALTER TABLE parent_questions DROP CONSTRAINT ' || quote_ident(rec.conname);
  END LOOP;
END $$;

ALTER TABLE parent_questions ADD CONSTRAINT parent_questions_status_check 
  CHECK (status IN (
    -- 기존 상태 호환
    '대기중', '전달됨', '중지됨',
    -- 신규 상태
    'draft', 'ai_generated', 'parent_edited', 'mission_confirming', 
    'confirmed', 'declined', 'mission_incomplete', 'failed_system', 'failed_recovered'
  ));

-- 4. parent_questions 신규 컬럼 추가
ALTER TABLE parent_questions
  ADD COLUMN request_idempotency_key TEXT UNIQUE,
  ADD COLUMN deadline_at TIMESTAMPTZ DEFAULT (now() + interval '48 hours'),
  ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_retry_at TIMESTAMPTZ,
  ADD COLUMN mission_confirm_attempts INTEGER NOT NULL DEFAULT 0 
    CHECK (mission_confirm_attempts >= 0 AND mission_confirm_attempts <= 2);
