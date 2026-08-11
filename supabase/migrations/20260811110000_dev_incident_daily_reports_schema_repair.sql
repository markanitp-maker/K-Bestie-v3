-- 2026-08-11 Dev P0 장애 복구: daily_reports 및 관련 테이블 스키마 백필.
-- 대표님 명시 지시(P0 복구 지시서) — Production DB는 대상 아님, Dev(mkrsaaedxqrcrktapaus) 전용.
--
-- 근거: information_schema/pg_catalog로 Dev와 Production을 직접 비교한 결과,
-- daily_reports가 2026-07-11 ~ 2026-08-04 사이에 순차 적용된 아래 마이그레이션들의
-- 컬럼/제약/인덱스/RLS를 전혀 반영하지 못한 상태였다(원인: 이전 Dev 데이터 유실
-- 사고 이후 마이그레이션 히스토리가 부분적으로만 재적용됨):
--   20260711000000_daily_reports_dashboard_cards.sql
--   20260715000000_soft_delete_columns.sql (DRAFT였으나 Production에는 이미 반영됨)
--   20260721300001_daily_reports_viewed_at.sql
--   20260725000000_daily_reports_eight_fields.sql
--   20260765000000_daily_reports_child_date_keyed.sql
--   20260766000000_daily_reports_select_rls_child_id.sql
--   20260802200000_daily_reports_generation_info.sql
--   20260803120000_daily_reports_teacher_adults.sql
--   20260804100000_report_parent_guide_split.sql
-- save_and_complete_daily_report_job_v3 RPC 함수 자체는 이미 Dev에 최신 본문(Production과
-- 바이트 단위로 동일, pg_get_functiondef로 직접 대조 확인)으로 존재하므로 이 마이그레이션에서
-- 재정의하지 않는다 — 함수가 참조하는 컬럼들이 없어서 실제 호출 시에만 실패하는 상태였을 뿐이다.
--
-- 전부 순수 추가(ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / CREATE OR REPLACE VIEW)
-- 이며 기존 행 데이터는 삭제하지 않는다. session_id를 NOT NULL에서 nullable로 완화하는 것도
-- 컬럼 자체를 남겨두므로 데이터 손실이 아니다(Production과 동일 상태로 맞추는 것뿐).

BEGIN;

-- ── 1. daily_reports 컬럼 백필 ──────────────────────────────────
ALTER TABLE public.daily_reports
  ALTER COLUMN session_id DROP NOT NULL;

ALTER TABLE public.daily_reports
  ADD COLUMN IF NOT EXISTS emotion_level text,
  ADD COLUMN IF NOT EXISTS dashboard_cards jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS viewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS school_academy_life text,
  ADD COLUMN IF NOT EXISTS peer_friendship text,
  ADD COLUMN IF NOT EXISTS emotion_hint text,
  ADD COLUMN IF NOT EXISTS interests_preferences text,
  ADD COLUMN IF NOT EXISTS study_concerns text,
  ADD COLUMN IF NOT EXISTS digital_content_interests text,
  ADD COLUMN IF NOT EXISTS future_dreams text,
  ADD COLUMN IF NOT EXISTS recurring_stories text,
  ADD COLUMN IF NOT EXISTS child_id uuid REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS business_date date,
  ADD COLUMN IF NOT EXISTS generation_source text,
  ADD COLUMN IF NOT EXISTS generation_version integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source_data_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS teacher_adults text,
  ADD COLUMN IF NOT EXISTS parent_conversation_clue text,
  ADD COLUMN IF NOT EXISTS recommended_questions jsonb;

-- emotion_level CHECK 제약 (컬럼 신규 추가이므로 존재 여부 확인 없이 안전하게 추가 가능한
-- 시점이지만, 재실행 대비 방어적으로 존재 확인 후 추가한다)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'daily_reports_emotion_level_check'
  ) THEN
    ALTER TABLE public.daily_reports
      ADD CONSTRAINT daily_reports_emotion_level_check
      CHECK (emotion_level = ANY (ARRAY['safe'::text, 'warning'::text, 'danger'::text]));
  END IF;
END $$;

-- 기존 행 백필: session_id → chat_sessions.child_id, business_date는 생성 시각(KST) 기준 근사치.
UPDATE public.daily_reports dr
SET
  child_id = cs.child_id,
  business_date = (dr.created_at AT TIME ZONE 'Asia/Seoul')::date
FROM public.chat_sessions cs
WHERE dr.session_id = cs.id
  AND dr.child_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_daily_reports_child_date
  ON public.daily_reports (child_id, business_date);

-- ── 2. daily_reports_select RLS를 child_id 기반 최종본으로 교체 ──
DROP POLICY IF EXISTS "daily_reports_select" ON public.daily_reports;
CREATE POLICY "daily_reports_select"
  ON public.daily_reports FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.child_profiles cp
      JOIN public.family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = daily_reports.child_id
        AND fm.user_id = auth.uid()
        AND fm.role = ANY (ARRAY['owner_parent', 'parent'])
    )
  );

GRANT ALL ON public.daily_reports TO anon, authenticated;

-- ── 3. 같은 소프트삭제 마이그레이션(20260715000000)의 나머지 테이블 컬럼 백필 ──
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.weekly_summaries
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS parent_conversation_clue text,
  ADD COLUMN IF NOT EXISTS recommended_questions jsonb;

GRANT ALL ON public.weekly_summaries TO anon, authenticated;

-- ── 4. 활성 데이터 필터링 뷰 4종 (누락 확인, Production과 동일 정의) ──
CREATE OR REPLACE VIEW public.active_chat_sessions AS
SELECT s.*
FROM public.chat_sessions s
WHERE s.deleted_at IS NULL;

CREATE OR REPLACE VIEW public.active_chat_messages AS
SELECT m.*
FROM public.chat_messages m
JOIN public.chat_sessions s ON s.id = m.session_id
WHERE m.deleted_at IS NULL
  AND s.deleted_at IS NULL;

CREATE OR REPLACE VIEW public.active_daily_reports AS
SELECT r.*
FROM public.daily_reports r
JOIN public.chat_sessions s ON s.id = r.session_id
WHERE r.deleted_at IS NULL
  AND s.deleted_at IS NULL;

CREATE OR REPLACE VIEW public.active_weekly_summaries AS
SELECT w.*
FROM public.weekly_summaries w
WHERE w.deleted_at IS NULL;

COMMIT;
