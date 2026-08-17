-- 078 Phase A — 질문은행 메타데이터 확장 (question_family, rapport_weight, time_of_day)
-- 모든 컬럼은 nullable로 추가하여 안전한 롤백 및 점진적 백필을 보장한다.
-- NOT NULL 제약 및 기본값 강제 금지 (AGENTS.md / 078 Request §19).
-- 마이그레이션 실행은 Phase A 정적 리뷰 통과 후 별도 게이트에서 수행한다.

ALTER TABLE public.mission_questions
  ADD COLUMN IF NOT EXISTS question_family TEXT,
  ADD COLUMN IF NOT EXISTS rapport_weight SMALLINT,
  ADD COLUMN IF NOT EXISTS time_of_day TEXT;

-- question_family는 7-Day rotation 및 첫 질문 중복 방지의 핵심 조회 조건으로 사용되므로
-- 활성 질문(is_active = true)에 대해 partial index를 생성한다.
CREATE INDEX IF NOT EXISTS idx_mission_questions_question_family
  ON public.mission_questions (question_family)
  WHERE is_active = true;

COMMENT ON COLUMN public.mission_questions.question_family IS '문장 표현이 달라도 사실상 동일한 질문을 묶어 7일 내 반복을 방지하는 질문 패밀리 식별자';
COMMENT ON COLUMN public.mission_questions.rapport_weight IS '초기 관계(NEW/WARMING)에서 친해지기 가중치 (0~3)';
COMMENT ON COLUMN public.mission_questions.time_of_day IS '질문 적합 시간대 (morning/daytime/evening/any)';
