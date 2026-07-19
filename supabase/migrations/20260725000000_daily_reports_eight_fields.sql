-- Migration: Add 8 fields for parent dashboard to daily_reports

ALTER TABLE public.daily_reports
ADD COLUMN IF NOT EXISTS school_academy_life text,
ADD COLUMN IF NOT EXISTS peer_friendship text,
ADD COLUMN IF NOT EXISTS emotion_hint text,
ADD COLUMN IF NOT EXISTS interests_preferences text,
ADD COLUMN IF NOT EXISTS study_concerns text,
ADD COLUMN IF NOT EXISTS digital_content_interests text,
ADD COLUMN IF NOT EXISTS future_dreams text,
ADD COLUMN IF NOT EXISTS recurring_stories text;

-- Mark existing emotion/mood columns as deprecated
COMMENT ON COLUMN public.daily_reports.mood_score IS 'deprecated (신규 8항목으로 대체 예정)';
COMMENT ON COLUMN public.daily_reports.emotion_tags IS 'deprecated (신규 8항목으로 대체 예정)';
COMMENT ON COLUMN public.daily_reports.emotion_level IS 'deprecated (신규 8항목으로 대체 예정)';

-- Ensure proper grants
GRANT ALL ON public.daily_reports TO anon, authenticated;
