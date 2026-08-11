-- Dev-only verification for 20260811180000_plan_retention_hard_delete.sql.
-- Run as service_role after the migration. Every fixture/delete is rolled back.

BEGIN;

DO $$
BEGIN
  IF public.get_plan_retention_months(1, 9, 5) <> 6 THEN
    RAISE EXCEPTION 'START_RETENTION_MISMATCH';
  END IF;
  IF public.get_plan_retention_months(2, 0, 5) <> 36 THEN
    RAISE EXCEPTION 'INSIGHT_BASE_RETENTION_MISMATCH';
  END IF;
  IF public.get_plan_retention_months(2, 2, 5) <> 60 THEN
    RAISE EXCEPTION 'INSIGHT_EXTENSION_RETENTION_MISMATCH';
  END IF;
  IF public.get_plan_retention_months(2, 99, 5) <> 144 THEN
    RAISE EXCEPTION 'INSIGHT_EXTENSION_CLAMP_MISMATCH';
  END IF;
  IF public.get_plan_retention_months(3, 0, 5) <> 60 THEN
    RAISE EXCEPTION 'PREMIUM_RETENTION_MISMATCH';
  END IF;
  IF public.get_plan_retention_months(3, 0, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'PREMIUM_UNLIMITED_MUST_BE_NULL';
  END IF;
END $$;

CREATE TEMP TABLE plan_retention_test_scenarios (
  scenario TEXT PRIMARY KEY,
  family_id UUID NOT NULL,
  child_id UUID NOT NULL,
  tier INTEGER NOT NULL,
  premium_years INTEGER,
  extension_years INTEGER NOT NULL DEFAULT 0,
  purge_batch_id UUID
);

INSERT INTO plan_retention_test_scenarios
  (scenario, family_id, child_id, tier, premium_years, extension_years, purge_batch_id)
VALUES
  ('start', gen_random_uuid(), gen_random_uuid(), 1, 5, 0, NULL),
  ('insight', gen_random_uuid(), gen_random_uuid(), 2, 5, 0, NULL),
  ('insight_extension', gen_random_uuid(), gen_random_uuid(), 2, 5, 2, NULL),
  ('premium_five', gen_random_uuid(), gen_random_uuid(), 3, 5, 0, NULL),
  ('premium_unlimited', gen_random_uuid(), gen_random_uuid(), 3, NULL, 0, NULL),
  ('premium_toggle', gen_random_uuid(), gen_random_uuid(), 3, NULL, 0, NULL),
  ('withdrawn_under_30d', gen_random_uuid(), gen_random_uuid(), 1, 5, 0, gen_random_uuid()),
  ('withdrawn_over_30d', gen_random_uuid(), gen_random_uuid(), 1, 5, 0, gen_random_uuid());

INSERT INTO public.families (id, name, premium_retention_years, purge_batch_id, created_by)
SELECT family_id, 'plan-retention-test-' || scenario, premium_years, purge_batch_id,
  'b2aeabb4-7300-464b-abe2-ae2cfe97afab'::uuid
FROM plan_retention_test_scenarios;

INSERT INTO public.child_profiles (id, family_id, name, grade, tier)
SELECT child_id, family_id, 'retention-test', '1학년', tier
FROM plan_retention_test_scenarios;

INSERT INTO public.insight_retention_extensions (family_id, extension_years_purchased)
SELECT family_id, extension_years
FROM plan_retention_test_scenarios
WHERE tier = 2;

CREATE TEMP TABLE plan_retention_test_rows (
  scenario TEXT NOT NULL,
  row_kind TEXT NOT NULL,
  row_state TEXT NOT NULL,
  row_id UUID NOT NULL
);

-- Daily report boundaries. Exact cutoff is retained; one day older is purged.
WITH inserted AS (
  INSERT INTO public.daily_reports (
    id, child_id, business_date, summary_line, mood_score, emotion_tags, parent_guide, deleted_at
  )
  SELECT gen_random_uuid(), child_id, DATE '2026-02-11', 'test', 5, '{}', 'test', NULL
  FROM plan_retention_test_scenarios WHERE scenario = 'start'
  RETURNING id
)
INSERT INTO plan_retention_test_rows SELECT 'start', 'daily', 'boundary', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.daily_reports (
    id, child_id, business_date, summary_line, mood_score, emotion_tags, parent_guide, deleted_at
  )
  SELECT gen_random_uuid(), child_id, DATE '2026-02-10', 'test', 5, '{}', 'test', NULL
  FROM plan_retention_test_scenarios WHERE scenario = 'start'
  RETURNING id
)
INSERT INTO plan_retention_test_rows SELECT 'start', 'daily', 'expired', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.daily_reports (
    id, child_id, business_date, summary_line, mood_score, emotion_tags, parent_guide, deleted_at
  )
  SELECT gen_random_uuid(), child_id, DATE '2023-08-11', 'test', 5, '{}', 'test', NULL
  FROM plan_retention_test_scenarios WHERE scenario = 'insight'
  RETURNING id
)
INSERT INTO plan_retention_test_rows SELECT 'insight', 'daily', 'boundary', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.daily_reports (
    id, child_id, business_date, summary_line, mood_score, emotion_tags, parent_guide, deleted_at
  )
  SELECT gen_random_uuid(), child_id, DATE '2023-08-10', 'test', 5, '{}', 'test', NULL
  FROM plan_retention_test_scenarios WHERE scenario = 'insight'
  RETURNING id
)
INSERT INTO plan_retention_test_rows SELECT 'insight', 'daily', 'expired', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.daily_reports (
    id, child_id, business_date, summary_line, mood_score, emotion_tags, parent_guide, deleted_at
  )
  SELECT gen_random_uuid(), child_id, DATE '2021-08-10', 'test', 5, '{}', 'test', NULL
  FROM plan_retention_test_scenarios WHERE scenario = 'insight_extension'
  RETURNING id
)
INSERT INTO plan_retention_test_rows SELECT 'insight_extension', 'daily', 'expired', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.daily_reports (
    id, child_id, business_date, summary_line, mood_score, emotion_tags, parent_guide, deleted_at
  )
  SELECT gen_random_uuid(), child_id, DATE '2021-08-11', 'test', 5, '{}', 'test', NULL
  FROM plan_retention_test_scenarios WHERE scenario = 'premium_five'
  RETURNING id
)
INSERT INTO plan_retention_test_rows SELECT 'premium_five', 'daily', 'boundary', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.daily_reports (
    id, child_id, business_date, summary_line, mood_score, emotion_tags, parent_guide, deleted_at
  )
  SELECT gen_random_uuid(), child_id, DATE '2021-08-10', 'test', 5, '{}', 'test', NULL
  FROM plan_retention_test_scenarios WHERE scenario = 'premium_five'
  RETURNING id
)
INSERT INTO plan_retention_test_rows SELECT 'premium_five', 'daily', 'expired', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.daily_reports (
    id, child_id, business_date, summary_line, mood_score, emotion_tags, parent_guide, deleted_at
  )
  SELECT gen_random_uuid(), child_id, DATE '2000-01-01', 'test', 5, '{}', 'test', NULL
  FROM plan_retention_test_scenarios WHERE scenario IN ('premium_unlimited', 'premium_toggle')
  RETURNING id, child_id
)
INSERT INTO plan_retention_test_rows
SELECT s.scenario, 'daily', 'very_old', i.id
FROM inserted i
JOIN plan_retention_test_scenarios s ON s.child_id = i.child_id;

-- Downgrade-stamped rows remain the separate grace purge's responsibility.
WITH inserted AS (
  INSERT INTO public.daily_reports (
    id, child_id, business_date, summary_line, mood_score, emotion_tags, parent_guide, deleted_at
  )
  SELECT gen_random_uuid(), child_id, DATE '2000-01-01', 'test', 5, '{}', 'test', now()
  FROM plan_retention_test_scenarios WHERE scenario = 'start'
  RETURNING id
)
INSERT INTO plan_retention_test_rows SELECT 'start', 'daily', 'soft_deleted', id FROM inserted;

-- Families already assigned to account purge are excluded regardless of whether
-- their 30-day deadline is before or after the reference date.
WITH inserted AS (
  INSERT INTO public.daily_reports (
    id, child_id, business_date, summary_line, mood_score, emotion_tags, parent_guide, deleted_at
  )
  SELECT gen_random_uuid(), child_id, DATE '2000-01-01', 'test', 5, '{}', 'test', NULL
  FROM plan_retention_test_scenarios
  WHERE scenario IN ('withdrawn_under_30d', 'withdrawn_over_30d')
  RETURNING id, child_id
)
INSERT INTO plan_retention_test_rows
SELECT s.scenario, 'daily', 'account_purge_owned', i.id
FROM inserted i
JOIN plan_retention_test_scenarios s ON s.child_id = i.child_id;

-- Exercise the other two table-specific RPCs with actual expired rows.
WITH inserted AS (
  INSERT INTO public.weekly_summaries (
    id, child_id, week_start, week_end, summary_text, parent_guide, deleted_at
  )
  SELECT gen_random_uuid(), child_id, DATE '2026-02-10', DATE '2026-02-16', 'test', 'test', NULL
  FROM plan_retention_test_scenarios WHERE scenario = 'start'
  RETURNING id
)
INSERT INTO plan_retention_test_rows SELECT 'start', 'weekly', 'expired', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.child_memory (
    id, child_id, memory_type, category, content, business_date, deleted_at
  )
  SELECT gen_random_uuid(), child_id, 'long_term', 'event', 'test', DATE '2026-02-10', NULL
  FROM plan_retention_test_scenarios WHERE scenario = 'start'
  RETURNING id
)
INSERT INTO plan_retention_test_rows SELECT 'start', 'memory', 'expired', id FROM inserted;

DO $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT public.purge_plan_retention_daily_reports_batch(DATE '2026-08-11', 5000)
  INTO v_result;

  IF (v_result->>'deleted_count')::INTEGER <> 4 THEN
    RAISE EXCEPTION 'DAILY_DELETE_COUNT_MISMATCH: %', v_result;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plan_retention_test_rows tr
    JOIN public.daily_reports dr ON dr.id = tr.row_id
    WHERE tr.row_state = 'expired'
  ) THEN
    RAISE EXCEPTION 'EXPIRED_DAILY_REPORT_REMAINED';
  END IF;

  IF (
    SELECT count(*)
    FROM plan_retention_test_rows tr
    JOIN public.daily_reports dr ON dr.id = tr.row_id
    WHERE tr.row_state IN ('boundary', 'very_old', 'soft_deleted', 'account_purge_owned')
  ) <> 8 THEN
    RAISE EXCEPTION 'PROTECTED_DAILY_REPORT_MISSING';
  END IF;

  -- Unlimited -> five years must be recalculated on the next run.
  UPDATE public.families f
  SET premium_retention_years = 5
  FROM plan_retention_test_scenarios s
  WHERE s.scenario = 'premium_toggle' AND f.id = s.family_id;

  SELECT public.purge_plan_retention_daily_reports_batch(DATE '2026-08-11', 5000)
  INTO v_result;

  IF (v_result->>'deleted_count')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'UNLIMITED_TO_FIVE_RECALC_MISMATCH: %', v_result;
  END IF;

  SELECT public.purge_plan_retention_weekly_summaries_batch(DATE '2026-08-11', 5000)
  INTO v_result;
  IF (v_result->>'deleted_count')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'WEEKLY_DELETE_COUNT_MISMATCH: %', v_result;
  END IF;

  SELECT public.purge_plan_retention_child_memory_batch(DATE '2026-08-11', 5000)
  INTO v_result;
  IF (v_result->>'deleted_count')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'MEMORY_DELETE_COUNT_MISMATCH: %', v_result;
  END IF;

  -- Static DB-level non-interference guard: none of the new purge functions may
  -- reference V3 raw/corrected tables or the account purge RPC.
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'purge_plan_retention_%_batch'
      AND (
        pg_get_functiondef(p.oid) ILIKE '%raw_daily_conversations_v3%'
        OR pg_get_functiondef(p.oid) ILIKE '%corrected_daily_conversations_v3%'
        OR pg_get_functiondef(p.oid) ILIKE '%purge_account_family_data%'
      )
  ) THEN
    RAISE EXCEPTION 'PURGE_PIPELINE_INTERFERENCE_DETECTED';
  END IF;
END $$;

ROLLBACK;
