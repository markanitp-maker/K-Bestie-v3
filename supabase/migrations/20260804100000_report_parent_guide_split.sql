-- requests/024-parent-guide-question-separation.md
-- 부모 대화 실마리(parent_conversation_clue)와 부모용 추천 질문(recommended_questions)을
-- 기존 단일 parent_guide 문자열에서 완전히 분리된 필드로 저장한다.
-- 기존 parent_guide는 과거 데이터 호환을 위해 그대로 유지하고 삭제하지 않는다(§8/§12).

ALTER TABLE public.daily_reports
  ADD COLUMN IF NOT EXISTS parent_conversation_clue text,
  ADD COLUMN IF NOT EXISTS recommended_questions jsonb;

ALTER TABLE public.weekly_summaries
  ADD COLUMN IF NOT EXISTS parent_conversation_clue text,
  ADD COLUMN IF NOT EXISTS recommended_questions jsonb;

COMMENT ON COLUMN public.daily_reports.parent_conversation_clue IS '부모 대화 실마리 — 아이 상황·부모 접근 방향 설명(질문 아님). requests/024, 2026-08-04';
COMMENT ON COLUMN public.daily_reports.recommended_questions IS '부모용 추천 질문 배열(2~3개, 의문문). requests/024, 2026-08-04';
COMMENT ON COLUMN public.weekly_summaries.parent_conversation_clue IS '주간 부모 대화 실마리(질문 아님). requests/024, 2026-08-04';
COMMENT ON COLUMN public.weekly_summaries.recommended_questions IS '주간 부모용 추천 질문 배열(2~3개, 의문문). requests/024, 2026-08-04';

GRANT ALL ON public.daily_reports TO anon, authenticated;
GRANT ALL ON public.weekly_summaries TO anon, authenticated;

-- Rollback:
-- ALTER TABLE public.daily_reports DROP COLUMN IF EXISTS parent_conversation_clue, DROP COLUMN IF EXISTS recommended_questions;
-- ALTER TABLE public.weekly_summaries DROP COLUMN IF EXISTS parent_conversation_clue, DROP COLUMN IF EXISTS recommended_questions;
