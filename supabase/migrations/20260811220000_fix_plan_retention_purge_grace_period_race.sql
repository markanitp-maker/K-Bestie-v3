-- Fixes a real permanent-data-loss race flagged by codex-rv(Sol) gate① review of
-- 20260811210000: purge_plan_retention_daily_reports_batch (and, on inspection,
-- the sibling weekly_summaries/child_memory batches from 20260811180000) hard-deleted
-- any row with deleted_at IS NULL that was already older than the CURRENT effective
-- retention window. Because a plan downgrade updates child_profiles/families
-- synchronously but lib/plan/retentionStamp.ts's soft-delete stamping runs as a
-- separate, non-atomic follow-up call, a row could sit in the "active, but already
-- past the new shorter retention window" state for a window of time. If this batch
-- ran during that window, it hard-deleted the row immediately — skipping the
-- intended 30-day soft-delete grace period entirely (worse than the S1 bug it
-- replaced, which only lost reference rows, not the report itself).
--
-- Fix: make each batch self-contained and two-phase, in a single transaction:
--   Phase 1 — stamp (soft-delete) newly-eligible ACTIVE rows with deleted_at = now().
--             This subsumes lib/plan/retentionStamp.ts's job for rows it hasn't
--             reached yet; re-stamping an already-stamped row never happens because
--             phase 1 only touches deleted_at IS NULL rows.
--   Phase 2 — hard-delete rows that were stamped (by phase 1, by this function on a
--             prior run, or by retentionStamp.ts directly) at least 30 days ago.
-- A row can now only ever go active -> stamped -> (>=30 days later) -> hard-deleted.
-- No path skips the grace period, regardless of which process set deleted_at first.
--
-- This migration only adds new function bodies (CREATE OR REPLACE) — it does not
-- modify already-applied 20260811180000/20260811190000/20260811210000 files.

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
  v_grace_cutoff TIMESTAMPTZ;
  v_stamp_now TIMESTAMPTZ := now();
  v_stamped_count INTEGER := 0;
  v_purge_ids UUID[] := ARRAY[]::UUID[];
  v_deleted_count INTEGER := 0;
  v_has_more BOOLEAN := false;
BEGIN
  v_reference_date := COALESCE(
    p_reference_date,
    (now() AT TIME ZONE 'Asia/Seoul')::DATE
  );
  v_grace_cutoff := v_stamp_now - INTERVAL '30 days';

  IF v_reference_date > (now() AT TIME ZONE 'Asia/Seoul')::DATE THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_reference_date cannot be in the future';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_limit must be an integer between 1 and 5000';
  END IF;

  -- Phase 1: stamp newly-eligible active rows.
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
  ),
  stamped_rows AS (
    UPDATE public.daily_reports dr
    SET deleted_at = v_stamp_now
    FROM target_rows tr
    WHERE dr.id = tr.id
      AND dr.deleted_at IS NULL
    RETURNING dr.id
  )
  SELECT count(*)::INTEGER INTO v_stamped_count FROM stamped_rows;

  -- Phase 2: hard-delete rows stamped at least 30 days ago (by this function or by
  -- lib/plan/retentionStamp.ts directly).
  WITH purge_rows AS (
    SELECT dr.id
    FROM public.daily_reports dr
    WHERE dr.deleted_at IS NOT NULL
      AND dr.deleted_at < v_grace_cutoff
    ORDER BY dr.deleted_at ASC, dr.id ASC
    LIMIT p_limit
  )
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::UUID[])
  INTO v_purge_ids
  FROM purge_rows;

  IF cardinality(v_purge_ids) > 0 THEN
    DELETE FROM public.evidence_card_links
    WHERE daily_report_id = ANY(v_purge_ids);

    DELETE FROM public.report_views
    WHERE report_id = ANY(v_purge_ids);

    WITH deleted_rows AS (
      DELETE FROM public.daily_reports dr
      WHERE dr.id = ANY(v_purge_ids)
        AND dr.deleted_at IS NOT NULL
        AND dr.deleted_at < v_grace_cutoff
      RETURNING dr.id
    )
    SELECT count(*)::INTEGER INTO v_deleted_count FROM deleted_rows;
  END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM public.daily_reports dr
      JOIN (
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
      ) ec ON ec.child_id = dr.child_id
      WHERE dr.deleted_at IS NULL
        AND dr.business_date IS NOT NULL
        AND ec.effective_months IS NOT NULL
        AND dr.business_date < (
          v_reference_date - make_interval(months => ec.effective_months)
        )::DATE
    )
    OR EXISTS (
      SELECT 1 FROM public.daily_reports dr
      WHERE dr.deleted_at IS NOT NULL AND dr.deleted_at < v_grace_cutoff
    )
  INTO v_has_more;

  RETURN jsonb_build_object(
    'dataset', 'daily_reports',
    'reference_date', v_reference_date,
    'stamped_count', v_stamped_count,
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
  v_grace_cutoff TIMESTAMPTZ;
  v_stamp_now TIMESTAMPTZ := now();
  v_stamped_count INTEGER := 0;
  v_deleted_count INTEGER := 0;
  v_has_more BOOLEAN := false;
BEGIN
  v_reference_date := COALESCE(
    p_reference_date,
    (now() AT TIME ZONE 'Asia/Seoul')::DATE
  );
  v_grace_cutoff := v_stamp_now - INTERVAL '30 days';

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
  stamped_rows AS (
    UPDATE public.weekly_summaries ws
    SET deleted_at = v_stamp_now
    FROM target_rows tr
    WHERE ws.id = tr.id
      AND ws.deleted_at IS NULL
    RETURNING ws.id
  )
  SELECT count(*)::INTEGER INTO v_stamped_count FROM stamped_rows;

  WITH deleted_rows AS (
    DELETE FROM public.weekly_summaries ws
    WHERE ws.id IN (
      SELECT id FROM public.weekly_summaries
      WHERE deleted_at IS NOT NULL AND deleted_at < v_grace_cutoff
      ORDER BY deleted_at ASC, id ASC
      LIMIT p_limit
    )
      AND ws.deleted_at IS NOT NULL
      AND ws.deleted_at < v_grace_cutoff
    RETURNING ws.id
  )
  SELECT count(*)::INTEGER INTO v_deleted_count FROM deleted_rows;

  SELECT
    EXISTS (
      SELECT 1
      FROM public.weekly_summaries ws
      JOIN (
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
      ) ec ON ec.child_id = ws.child_id
      WHERE ws.deleted_at IS NULL
        AND ws.week_start IS NOT NULL
        AND ec.effective_months IS NOT NULL
        AND ws.week_start < (
          v_reference_date - make_interval(months => ec.effective_months)
        )::DATE
    )
    OR EXISTS (
      SELECT 1 FROM public.weekly_summaries ws
      WHERE ws.deleted_at IS NOT NULL AND ws.deleted_at < v_grace_cutoff
    )
  INTO v_has_more;

  RETURN jsonb_build_object(
    'dataset', 'weekly_summaries',
    'reference_date', v_reference_date,
    'stamped_count', v_stamped_count,
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
  v_grace_cutoff TIMESTAMPTZ;
  v_stamp_now TIMESTAMPTZ := now();
  v_stamped_count INTEGER := 0;
  v_deleted_count INTEGER := 0;
  v_has_more BOOLEAN := false;
BEGIN
  v_reference_date := COALESCE(
    p_reference_date,
    (now() AT TIME ZONE 'Asia/Seoul')::DATE
  );
  v_grace_cutoff := v_stamp_now - INTERVAL '30 days';

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
  stamped_rows AS (
    UPDATE public.child_memory cm
    SET deleted_at = v_stamp_now
    FROM target_rows tr
    WHERE cm.id = tr.id
      AND cm.deleted_at IS NULL
    RETURNING cm.id
  )
  SELECT count(*)::INTEGER INTO v_stamped_count FROM stamped_rows;

  WITH deleted_rows AS (
    DELETE FROM public.child_memory cm
    WHERE cm.id IN (
      SELECT id FROM public.child_memory
      WHERE deleted_at IS NOT NULL AND deleted_at < v_grace_cutoff
      ORDER BY deleted_at ASC, id ASC
      LIMIT p_limit
    )
      AND cm.deleted_at IS NOT NULL
      AND cm.deleted_at < v_grace_cutoff
    RETURNING cm.id
  )
  SELECT count(*)::INTEGER INTO v_deleted_count FROM deleted_rows;

  SELECT
    EXISTS (
      SELECT 1
      FROM public.child_memory cm
      JOIN (
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
      ) ec ON ec.child_id = cm.child_id
      WHERE cm.deleted_at IS NULL
        AND cm.business_date IS NOT NULL
        AND ec.effective_months IS NOT NULL
        AND cm.business_date < (
          v_reference_date - make_interval(months => ec.effective_months)
        )::DATE
    )
    OR EXISTS (
      SELECT 1 FROM public.child_memory cm
      WHERE cm.deleted_at IS NOT NULL AND cm.deleted_at < v_grace_cutoff
    )
  INTO v_has_more;

  RETURN jsonb_build_object(
    'dataset', 'child_memory',
    'reference_date', v_reference_date,
    'stamped_count', v_stamped_count,
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
