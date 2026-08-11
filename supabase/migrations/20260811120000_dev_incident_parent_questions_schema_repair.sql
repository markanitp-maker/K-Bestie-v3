-- 2026-08-11 Dev P0 장애 복구: parent_questions 스키마 백필.
-- Production DB는 대상 아님, Dev(mkrsaaedxqrcrktapaus) 전용.
--
-- 근거: information_schema/pg_catalog로 Dev와 Production을 직접 비교한 결과,
-- parent_questions에 phase1_schema.sql 이후 여러 마이그레이션(질문 라이프사이클,
-- 라우터, 재확인 플로우 등)이 추가한 21개 컬럼과 관련 제약/인덱스가 전혀 없었다.
-- app/api/parent/questions/route.ts의 GET(child_answer_summary SELECT)과
-- POST(status: "draft" INSERT — 기존 3값짜리 status CHECK 제약 위반)가 모두 이 상태에서
-- 실패한다. 컬럼 정의는 Production의 information_schema.columns/pg_constraint를 그대로
-- 옮긴 것이며 신규 로직을 추가하지 않는다. 전부 순수 추가이며 기존 3개 행의 데이터는
-- 삭제하지 않는다(모든 신규 컬럼이 NULL 허용이거나 안전한 기본값을 가짐).

BEGIN;

ALTER TABLE public.parent_questions
  ADD COLUMN IF NOT EXISTS request_idempotency_key text,
  ADD COLUMN IF NOT EXISTS deadline_at timestamptz DEFAULT (now() + interval '7 days'),
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS mission_confirm_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS child_answer_summary text,
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_question_text text,
  ADD COLUMN IF NOT EXISTS confirmation_question_text text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS expired_at timestamptz,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS source_grade smallint,
  ADD COLUMN IF NOT EXISTS router_route text,
  ADD COLUMN IF NOT EXISTS router_area text,
  ADD COLUMN IF NOT EXISTS router_rule_id text,
  ADD COLUMN IF NOT EXISTS router_policy_version text,
  ADD COLUMN IF NOT EXISTS router_confidence numeric,
  ADD COLUMN IF NOT EXISTS router_evidence jsonb;

-- status CHECK 제약을 Production의 15값 라이프사이클 버전으로 교체
-- (기존 Dev 제약은 '대기중'/'전달됨'/'중지됨' 3값뿐이라 route.ts의 status:"draft" INSERT가
-- 항상 CHECK 위반으로 실패했다)
ALTER TABLE public.parent_questions
  DROP CONSTRAINT IF EXISTS parent_questions_status_check;
ALTER TABLE public.parent_questions
  ADD CONSTRAINT parent_questions_status_check
  CHECK (status = ANY (ARRAY[
    '대기중'::text, '전달됨'::text, '중지됨'::text,
    'draft'::text, 'ai_generated'::text, 'parent_edited'::text,
    'mission_confirming'::text, 'reconfirm_pending'::text, 'confirmed'::text,
    'declined'::text, 'cancelled'::text, 'expired'::text,
    'mission_incomplete'::text, 'failed_system'::text, 'failed_recovered'::text
  ]));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parent_questions_mission_confirm_attempts_check') THEN
    ALTER TABLE public.parent_questions
      ADD CONSTRAINT parent_questions_mission_confirm_attempts_check
      CHECK (mission_confirm_attempts >= 0 AND mission_confirm_attempts <= 2);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parent_questions_router_route_check') THEN
    ALTER TABLE public.parent_questions
      ADD CONSTRAINT parent_questions_router_route_check
      CHECK (router_route IS NULL OR router_route = ANY (ARRAY['CRISIS'::text, 'RED'::text, 'GREEN'::text]));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parent_questions_request_idempotency_key_key') THEN
    ALTER TABLE public.parent_questions
      ADD CONSTRAINT parent_questions_request_idempotency_key_key UNIQUE (request_idempotency_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_parent_questions_source ON public.parent_questions (source);
CREATE INDEX IF NOT EXISTS idx_parent_questions_router_route ON public.parent_questions (router_route);

GRANT ALL ON public.parent_questions TO anon, authenticated;

COMMIT;
