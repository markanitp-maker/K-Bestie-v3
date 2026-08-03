-- 초안 (DDL DRAFT ONLY) — 실행 금지, 대표 승인 후 대표가 직접 실행할 것
-- 목적: requests/019-parent-dashboard-15char-summary-fix.md §9 "선생님·어른 영역 구현"
--       부모 홈 8개 카드 중 유일하게 DB 컬럼이 없던 "선생님·어른" 상세 텍스트 필드 추가.
-- 참고: 15자 대시보드 요약은 신규 컬럼을 추가하지 않고 기존 daily_reports.dashboard_cards
--       (jsonb, 2026-07-11 마이그레이션에서 추가된 뒤 방치돼 항상 '{}'였음)를 재활용한다.

ALTER TABLE public.daily_reports
  ADD COLUMN IF NOT EXISTS teacher_adults text;

COMMENT ON COLUMN public.daily_reports.teacher_adults IS '선생님·어른 관련 상세 관찰 (requests/019, 2026-08-03)';
COMMENT ON COLUMN public.daily_reports.dashboard_cards IS '부모 홈 8개 카드용 공백포함 15자 이내 단문 요약 (requests/019, 2026-08-03 재활용) — 키: school_academy_life, peer_friendship, emotion_hint, interests_preferences, study_concerns, digital_content_interests, teacher_adults, recurring_stories';

GRANT ALL ON public.daily_reports TO anon, authenticated;
