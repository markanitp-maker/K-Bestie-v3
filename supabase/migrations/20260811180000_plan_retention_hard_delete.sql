-- Plan retention natural-expiry hard delete.
-- This migration intentionally does not touch:
--   * V3 raw/corrected 7-day purge
--   * WITHDRAWN_PENDING 30-day account purge
--   * downgrade soft-delete grace purge draft

-- Premium NULL is the explicit unlimited-retention value. Keep DEFAULT 5 so
-- existing/new families remain on the five-year default unless they opt in.
ALTER TABLE public.families
  ALTER COLUMN premium_retention_years DROP NOT NULL;

ALTER TABLE public.families
  DROP CONSTRAINT IF EXISTS families_premium_retention_years_check;

ALTER TABLE public.families
  ADD CONSTRAINT families_premium_retention_years_check
  CHECK (
    premium_retention_years IN (1, 3, 5)
    OR premium_retention_years IS NULL
  );

-- child_memory predates the soft-delete columns. Add the same active-row marker
-- so this purge can exclude any row reserved for a separate grace workflow.
ALTER TABLE public.child_memory
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_daily_reports_plan_retention_active
  ON public.daily_reports (business_date, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_weekly_summaries_plan_retention_active
  ON public.weekly_summaries (week_start, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_child_memory_plan_retention_active
  ON public.child_memory (business_date, id)
  WHERE deleted_at IS NULL;

-- SQL equivalent of lib/plan/retention.ts. NULL Premium years means unlimited.
CREATE OR REPLACE FUNCTION public.get_plan_retention_months(
  p_tier INTEGER,
  p_extension_years INTEGER,
  p_premium_retention_years INTEGER
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_tier = 1 THEN 6
    WHEN p_tier = 2 THEN
      (3 + LEAST(9, GREATEST(0, COALESCE(p_extension_years, 0)))) * 12
    WHEN p_tier = 3 AND p_premium_retention_years IS NULL THEN NULL
    WHEN p_tier = 3 THEN
      CASE
        WHEN p_premium_retention_years IN (1, 3, 5)
          THEN p_premium_retention_years * 12
        ELSE 60
      END
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.get_plan_retention_months(INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_plan_retention_months(INTEGER, INTEGER, INTEGER)
  TO service_role;

-- Bounded purge for active daily reports. Direct references are removed first,
-- even though current FKs use ON DELETE CASCADE, matching child-deletion cleanup.
CREATE OR REPLACE FUNCTION public.purge_plan_retention_daily_reports_batch(
  p_reference_date DATE DEFAULT NULL,
  p_limit INTEGER DEFAULT 1000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reference_date DATE;
  v_target_ids UUID[] := ARRAY[]::UUID[];
  v_deleted_count INTEGER := 0;
  v_has_more BOOLEAN := false;
BEGIN
  v_reference_date := COALESCE(
    p_reference_date,
    (now() AT TIME ZONE 'Asia/Seoul')::DATE
  );

  IF v_reference_date > (now() AT TIME ZONE 'Asia/Seoul')::DATE THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_reference_date cannot be in the future';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_limit must be an integer between 1 and 5000';
  END IF;

  WITH eligible_children AS (
    SELECT
      cp.id AS child_id,
      public.get_plan_retention_months(
        cp.tier,
        COALESCE(ire.extension_years_purchased, 0),
        f.premium_retention_years
      ) AS effective_months
    FROM public.child_profiles cp
    JOIN public.families f ON f.id = cp.family_id
    LEFT JOIN public.insight_retention_extensions ire ON ire.family_id = f.id
    WHERE f.deleted_at IS NULL
      AND f.purge_batch_id IS NULL
      AND (cp.tier <> 3 OR f.premium_retention_years IS NOT NULL)
  ),
  target_rows AS (
    SELECT dr.id
    FROM public.daily_reports dr
    JOIN eligible_children ec ON ec.child_id = dr.child_id
    WHERE dr.deleted_at IS NULL
      AND dr.business_date IS NOT NULL
      AND ec.effective_months IS NOT NULL
      AND dr.business_date < (
        v_reference_date - make_interval(months => ec.effective_months)
      )::DATE
    ORDER BY dr.business_date ASC, dr.id ASC
    LIMIT p_limit
  )
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::UUID[])
  INTO v_target_ids
  FROM target_rows;

  IF cardinality(v_target_ids) > 0 THEN
    DELETE FROM public.evidence_card_links
    WHERE daily_report_id = ANY(v_target_ids);

    DELETE FROM public.report_views
    WHERE report_id = ANY(v_target_ids);

    WITH deleted_rows AS (
      DELETE FROM public.daily_reports dr
      WHERE dr.id = ANY(v_target_ids)
        AND dr.deleted_at IS NULL
      RETURNING dr.id
    )
    SELECT count(*)::INTEGER INTO v_deleted_count FROM deleted_rows;
  END IF;

  WITH eligible_children AS (
    SELECT
      cp.id AS child_id,
      public.get_plan_retention_months(
        cp.tier,
        COALESCE(ire.extension_years_purchased, 0),
        f.premium_retention_years
      ) AS effective_months
    FROM public.child_profiles cp
    JOIN public.families f ON f.id = cp.family_id
    LEFT JOIN public.insight_retention_extensions ire ON ire.family_id = f.id
    WHERE f.deleted_at IS NULL
      AND f.purge_batch_id IS NULL
      AND (cp.tier <> 3 OR f.premium_retention_years IS NOT NULL)
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.daily_reports dr
    JOIN eligible_children ec ON ec.child_id = dr.child_id
    WHERE dr.deleted_at IS NULL
      AND dr.business_date IS NOT NULL
      AND ec.effective_months IS NOT NULL
      AND dr.business_date < (
        v_reference_date - make_interval(months => ec.effective_months)
      )::DATE
  ) INTO v_has_more;

  RETURN jsonb_build_object(
    'dataset', 'daily_reports',
    'reference_date', v_reference_date,
    'deleted_count', v_deleted_count,
    'limit', p_limit,
    'has_more', v_has_more
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_plan_retention_daily_reports_batch(DATE, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_plan_retention_daily_reports_batch(DATE, INTEGER)
  TO service_role;

-- Bounded purge for active weekly summaries.
CREATE OR REPLACE FUNCTION public.purge_plan_retention_weekly_summaries_batch(
  p_reference_date DATE DEFAULT NULL,
  p_limit INTEGER DEFAULT 1000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reference_date DATE;
  v_deleted_count INTEGER := 0;
  v_has_more BOOLEAN := false;
BEGIN
  v_reference_date := COALESCE(
    p_reference_date,
    (now() AT TIME ZONE 'Asia/Seoul')::DATE
  );

  IF v_reference_date > (now() AT TIME ZONE 'Asia/Seoul')::DATE THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_reference_date cannot be in the future';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_limit must be an integer between 1 and 5000';
  END IF;

  WITH eligible_children AS (
    SELECT
      cp.id AS child_id,
      public.get_plan_retention_months(
        cp.tier,
        COALESCE(ire.extension_years_purchased, 0),
        f.premium_retention_years
      ) AS effective_months
    FROM public.child_profiles cp
    JOIN public.families f ON f.id = cp.family_id
    LEFT JOIN public.insight_retention_extensions ire ON ire.family_id = f.id
    WHERE f.deleted_at IS NULL
      AND f.purge_batch_id IS NULL
      AND (cp.tier <> 3 OR f.premium_retention_years IS NOT NULL)
  ),
  target_rows AS (
    SELECT ws.id
    FROM public.weekly_summaries ws
    JOIN eligible_children ec ON ec.child_id = ws.child_id
    WHERE ws.deleted_at IS NULL
      AND ws.week_start IS NOT NULL
      AND ec.effective_months IS NOT NULL
      AND ws.week_start < (
        v_reference_date - make_interval(months => ec.effective_months)
      )::DATE
    ORDER BY ws.week_start ASC, ws.id ASC
    LIMIT p_limit
  ),
  deleted_rows AS (
    DELETE FROM public.weekly_summaries ws
    USING target_rows tr
    WHERE ws.id = tr.id
      AND ws.deleted_at IS NULL
    RETURNING ws.id
  )
  SELECT count(*)::INTEGER INTO v_deleted_count FROM deleted_rows;

  WITH eligible_children AS (
    SELECT
      cp.id AS child_id,
      public.get_plan_retention_months(
        cp.tier,
        COALESCE(ire.extension_years_purchased, 0),
        f.premium_retention_years
      ) AS effective_months
    FROM public.child_profiles cp
    JOIN public.families f ON f.id = cp.family_id
    LEFT JOIN public.insight_retention_extensions ire ON ire.family_id = f.id
    WHERE f.deleted_at IS NULL
      AND f.purge_batch_id IS NULL
      AND (cp.tier <> 3 OR f.premium_retention_years IS NOT NULL)
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.weekly_summaries ws
    JOIN eligible_children ec ON ec.child_id = ws.child_id
    WHERE ws.deleted_at IS NULL
      AND ws.week_start IS NOT NULL
      AND ec.effective_months IS NOT NULL
      AND ws.week_start < (
        v_reference_date - make_interval(months => ec.effective_months)
      )::DATE
  ) INTO v_has_more;

  RETURN jsonb_build_object(
    'dataset', 'weekly_summaries',
    'reference_date', v_reference_date,
    'deleted_count', v_deleted_count,
    'limit', p_limit,
    'has_more', v_has_more
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_plan_retention_weekly_summaries_batch(DATE, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_plan_retention_weekly_summaries_batch(DATE, INTEGER)
  TO service_role;

-- Bounded purge for active child memory rows.
CREATE OR REPLACE FUNCTION public.purge_plan_retention_child_memory_batch(
  p_reference_date DATE DEFAULT NULL,
  p_limit INTEGER DEFAULT 1000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reference_date DATE;
  v_deleted_count INTEGER := 0;
  v_has_more BOOLEAN := false;
BEGIN
  v_reference_date := COALESCE(
    p_reference_date,
    (now() AT TIME ZONE 'Asia/Seoul')::DATE
  );

  IF v_reference_date > (now() AT TIME ZONE 'Asia/Seoul')::DATE THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_reference_date cannot be in the future';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_limit must be an integer between 1 and 5000';
  END IF;

  WITH eligible_children AS (
    SELECT
      cp.id AS child_id,
      public.get_plan_retention_months(
        cp.tier,
        COALESCE(ire.extension_years_purchased, 0),
        f.premium_retention_years
      ) AS effective_months
    FROM public.child_profiles cp
    JOIN public.families f ON f.id = cp.family_id
    LEFT JOIN public.insight_retention_extensions ire ON ire.family_id = f.id
    WHERE f.deleted_at IS NULL
      AND f.purge_batch_id IS NULL
      AND (cp.tier <> 3 OR f.premium_retention_years IS NOT NULL)
  ),
  target_rows AS (
    SELECT cm.id
    FROM public.child_memory cm
    JOIN eligible_children ec ON ec.child_id = cm.child_id
    WHERE cm.deleted_at IS NULL
      AND cm.business_date IS NOT NULL
      AND ec.effective_months IS NOT NULL
      AND cm.business_date < (
        v_reference_date - make_interval(months => ec.effective_months)
      )::DATE
    ORDER BY cm.business_date ASC, cm.id ASC
    LIMIT p_limit
  ),
  deleted_rows AS (
    DELETE FROM public.child_memory cm
    USING target_rows tr
    WHERE cm.id = tr.id
      AND cm.deleted_at IS NULL
    RETURNING cm.id
  )
  SELECT count(*)::INTEGER INTO v_deleted_count FROM deleted_rows;

  WITH eligible_children AS (
    SELECT
      cp.id AS child_id,
      public.get_plan_retention_months(
        cp.tier,
        COALESCE(ire.extension_years_purchased, 0),
        f.premium_retention_years
      ) AS effective_months
    FROM public.child_profiles cp
    JOIN public.families f ON f.id = cp.family_id
    LEFT JOIN public.insight_retention_extensions ire ON ire.family_id = f.id
    WHERE f.deleted_at IS NULL
      AND f.purge_batch_id IS NULL
      AND (cp.tier <> 3 OR f.premium_retention_years IS NOT NULL)
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.child_memory cm
    JOIN eligible_children ec ON ec.child_id = cm.child_id
    WHERE cm.deleted_at IS NULL
      AND cm.business_date IS NOT NULL
      AND ec.effective_months IS NOT NULL
      AND cm.business_date < (
        v_reference_date - make_interval(months => ec.effective_months)
      )::DATE
  ) INTO v_has_more;

  RETURN jsonb_build_object(
    'dataset', 'child_memory',
    'reference_date', v_reference_date,
    'deleted_count', v_deleted_count,
    'limit', p_limit,
    'has_more', v_has_more
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_plan_retention_child_memory_batch(DATE, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_plan_retention_child_memory_batch(DATE, INTEGER)
  TO service_role;
