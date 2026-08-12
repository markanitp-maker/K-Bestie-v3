-- Keep dependency cleanup and the target report deletion atomic with respect to
-- the target id snapshot. Once an active report is selected, delete that exact
-- report even if a concurrent downgrade stamps deleted_at before this statement.
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
