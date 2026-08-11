-- Atomically apply a child plan tier change and the matching retention stamp/restore.
-- R3 purge/FK redesign is intentionally out of scope for this migration.

CREATE OR REPLACE FUNCTION public.apply_plan_tier_change(
  p_child_id UUID,
  p_new_tier INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_tier INTEGER;
  v_family_id UUID;
  v_premium_retention_years INTEGER;
  v_active_pack_count INTEGER;
  v_effective_months INTEGER;
  v_now TIMESTAMPTZ;
  v_grace_threshold TIMESTAMPTZ;
BEGIN
  IF p_new_tier IS NULL OR p_new_tier NOT IN (1, 2, 3) THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_new_tier must be 1, 2, or 3';
  END IF;

  -- Serialize self-service and admin approval paths for the same child. The admin
  -- request RPC already uses this key, so its validation and this mutation share
  -- one critical section.
  PERFORM pg_advisory_xact_lock(hashtext('plan_change_request_' || p_child_id::TEXT));

  SELECT cp.tier, cp.family_id
  INTO v_old_tier, v_family_id
  FROM public.child_profiles cp
  WHERE cp.id = p_child_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'old_tier', NULL,
      'new_tier', p_new_tier
    );
  END IF;

  -- FOR UPDATE (not FOR SHARE): serializes against purchase_insight_extension,
  -- which also locks this families row before touching
  -- insight_retention_extensions — closes the INSERT-race window where a
  -- concurrent extension purchase could be missed by the pack-count lookup
  -- below (reviewer-flagged gap, no advisory lock covers a row that doesn't
  -- exist yet).
  SELECT f.premium_retention_years
  INTO v_premium_retention_years
  FROM public.families f
  WHERE f.id = v_family_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DATA_INTEGRITY: family not found for child %', p_child_id;
  END IF;

  -- Look up the family's purchased Insight extension years inside the same
  -- transaction/lock instead of trusting a caller-supplied count (both call
  -- sites previously hardcoded 0, undercounting retention for extended families).
  SELECT COALESCE(ire.extension_years_purchased, 0)
  INTO v_active_pack_count
  FROM public.insight_retention_extensions ire
  WHERE ire.family_id = v_family_id;

  v_active_pack_count := COALESCE(v_active_pack_count, 0);

  -- Use one wall-clock instant for every cutoff. 720 hours matches the exact
  -- 30 * 24h grace duration used by retentionStamp.ts, independent of timezone.
  v_now := clock_timestamp();
  v_grace_threshold := v_now - INTERVAL '720 hours';

  -- SQL equivalent of getEffectiveRetention(). v_active_pack_count is already an
  -- integer, so only the TypeScript function's 0..9 clamp is required here.
  v_effective_months := CASE
    WHEN p_new_tier = 1 THEN 6
    WHEN p_new_tier = 2 THEN
      (3 + LEAST(9, GREATEST(0, v_active_pack_count))) * 12
    WHEN p_new_tier = 3 AND v_premium_retention_years IS NULL THEN NULL
    WHEN p_new_tier = 3 AND v_premium_retention_years IN (1, 3, 5) THEN
      v_premium_retention_years * 12
    WHEN p_new_tier = 3 THEN 60
  END;

  IF v_old_tier = p_new_tier THEN
    RETURN jsonb_build_object(
      'success', true,
      'old_tier', v_old_tier,
      'new_tier', p_new_tier
    );
  END IF;

  UPDATE public.child_profiles
  SET tier = p_new_tier
  WHERE id = p_child_id;

  IF p_new_tier < v_old_tier AND v_effective_months IS NOT NULL THEN
    -- addMonthsUtc() uses JavaScript Date.setUTCMonth(), whose month-end overflow
    -- differs from PostgreSQL's direct "timestamp + interval 'N months'" clamp.
    -- Rebuild each UTC timestamp from month-start + zero-based day offset so SQL
    -- has the same rollover and the same strict cutoff < now boundary.
    WITH target_sessions AS (
      SELECT cs.id
      FROM public.chat_sessions cs
      WHERE cs.child_id = p_child_id
        AND cs.deleted_at IS NULL
        AND (
          (
            date_trunc('month', cs.started_at AT TIME ZONE 'UTC')
            + make_interval(months => v_effective_months)
            + make_interval(days => EXTRACT(DAY FROM cs.started_at AT TIME ZONE 'UTC')::INTEGER - 1)
            + (
              (cs.started_at AT TIME ZONE 'UTC')
              - date_trunc('day', cs.started_at AT TIME ZONE 'UTC')
            )
          ) AT TIME ZONE 'UTC'
        ) < v_now
    ),
    stamped_sessions AS (
      UPDATE public.chat_sessions cs
      SET deleted_at = v_now
      FROM target_sessions target
      WHERE cs.id = target.id
      RETURNING cs.id
    )
    UPDATE public.chat_messages cm
    SET deleted_at = v_now
    FROM stamped_sessions stamped
    WHERE cm.session_id = stamped.id;

    UPDATE public.daily_reports dr
    SET deleted_at = v_now
    WHERE dr.child_id = p_child_id
      AND dr.business_date IS NOT NULL
      AND dr.deleted_at IS NULL
      AND (
        (
          date_trunc(
            'month',
            (dr.business_date::TIMESTAMP AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'
          )
          + make_interval(months => v_effective_months)
          + make_interval(
            days => EXTRACT(
              DAY FROM (dr.business_date::TIMESTAMP AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'
            )::INTEGER - 1
          )
          + (
            ((dr.business_date::TIMESTAMP AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC')
            - date_trunc(
              'day',
              (dr.business_date::TIMESTAMP AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'
            )
          )
        ) AT TIME ZONE 'UTC'
      ) < v_now;

    UPDATE public.weekly_summaries ws
    SET deleted_at = v_now
    WHERE ws.child_id = p_child_id
      AND ws.deleted_at IS NULL
      AND (
        (
          date_trunc('month', ws.week_start::TIMESTAMP)
          + make_interval(months => v_effective_months)
          + make_interval(days => EXTRACT(DAY FROM ws.week_start)::INTEGER - 1)
        ) AT TIME ZONE 'UTC'
      ) < v_now;
  ELSIF p_new_tier > v_old_tier THEN
    WITH target_sessions AS (
      SELECT cs.id
      FROM public.chat_sessions cs
      WHERE cs.child_id = p_child_id
        AND cs.deleted_at IS NOT NULL
        AND cs.deleted_at >= v_grace_threshold
        AND (
          v_effective_months IS NULL
          OR (
            (
              date_trunc('month', cs.started_at AT TIME ZONE 'UTC')
              + make_interval(months => v_effective_months)
              + make_interval(days => EXTRACT(DAY FROM cs.started_at AT TIME ZONE 'UTC')::INTEGER - 1)
              + (
                (cs.started_at AT TIME ZONE 'UTC')
                - date_trunc('day', cs.started_at AT TIME ZONE 'UTC')
              )
            ) AT TIME ZONE 'UTC'
          ) >= v_now
        )
    ),
    restored_sessions AS (
      UPDATE public.chat_sessions cs
      SET deleted_at = NULL
      FROM target_sessions target
      WHERE cs.id = target.id
      RETURNING cs.id
    )
    UPDATE public.chat_messages cm
    SET deleted_at = NULL
    FROM restored_sessions restored
    WHERE cm.session_id = restored.id;

    UPDATE public.daily_reports dr
    SET deleted_at = NULL
    WHERE dr.child_id = p_child_id
      AND dr.business_date IS NOT NULL
      AND dr.deleted_at IS NOT NULL
      AND dr.deleted_at >= v_grace_threshold
      AND (
        v_effective_months IS NULL
        OR (
          (
            date_trunc(
              'month',
              (dr.business_date::TIMESTAMP AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'
            )
            + make_interval(months => v_effective_months)
            + make_interval(
              days => EXTRACT(
                DAY FROM (dr.business_date::TIMESTAMP AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'
              )::INTEGER - 1
            )
            + (
              ((dr.business_date::TIMESTAMP AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC')
              - date_trunc(
                'day',
                (dr.business_date::TIMESTAMP AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'
              )
            )
          ) AT TIME ZONE 'UTC'
        ) >= v_now
      );

    UPDATE public.weekly_summaries ws
    SET deleted_at = NULL
    WHERE ws.child_id = p_child_id
      AND ws.deleted_at IS NOT NULL
      AND ws.deleted_at >= v_grace_threshold
      AND (
        v_effective_months IS NULL
        OR (
          (
            date_trunc('month', ws.week_start::TIMESTAMP)
            + make_interval(months => v_effective_months)
            + make_interval(days => EXTRACT(DAY FROM ws.week_start)::INTEGER - 1)
          ) AT TIME ZONE 'UTC'
        ) >= v_now
      );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'old_tier', v_old_tier,
    'new_tier', p_new_tier
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_plan_tier_change(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_plan_tier_change(UUID, INTEGER)
  TO service_role;

-- Keep request approval, tier mutation, retention updates, and audit logging in
-- the existing single admin RPC transaction. The API route therefore still makes
-- one RPC call, while the tier mutation itself is delegated to the new primitive.
CREATE OR REPLACE FUNCTION public.admin_approve_plan_change_request(
  p_admin_user_id UUID,
  p_admin_email TEXT,
  p_request_id UUID
)
RETURNS TABLE(success BOOLEAN, reason TEXT, child_id UUID, old_tier INT, new_tier INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req RECORD;
  v_actual_tier INTEGER;
  v_plan_result JSONB;
BEGIN
  SELECT * INTO v_req
  FROM public.plan_change_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'::TEXT, NULL::UUID, NULL::INT, NULL::INT;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('plan_change_request_' || v_req.child_id::TEXT));

  SELECT * INTO v_req
  FROM public.plan_change_requests
  WHERE id = p_request_id;

  -- Re-verify under the lock — the route's pre-check (deleted_at, requested_tier=3
  -- blocked) runs before this lock is acquired and can go stale under a race.
  IF v_req.deleted_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'deleted'::TEXT, v_req.child_id, NULL::INT, NULL::INT;
    RETURN;
  END IF;

  IF v_req.requested_tier = 3 THEN
    RETURN QUERY SELECT false, 'premium_blocked'::TEXT, v_req.child_id, NULL::INT, NULL::INT;
    RETURN;
  END IF;

  IF v_req.status != 'pending' THEN
    RETURN QUERY SELECT false, 'already_processed'::TEXT, v_req.child_id, NULL::INT, NULL::INT;
    RETURN;
  END IF;

  SELECT cp.tier
  INTO v_actual_tier
  FROM public.child_profiles cp
  WHERE cp.id = v_req.child_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'child_not_found'::TEXT, v_req.child_id, NULL::INT, NULL::INT;
    RETURN;
  END IF;

  IF v_actual_tier != v_req.current_plan_snapshot THEN
    RETURN QUERY
      SELECT false, 'tier_conflict'::TEXT, v_req.child_id, v_actual_tier, v_req.requested_tier;
    RETURN;
  END IF;

  v_plan_result := public.apply_plan_tier_change(v_req.child_id, v_req.requested_tier);

  IF NOT COALESCE((v_plan_result ->> 'success')::BOOLEAN, false) THEN
    RAISE EXCEPTION 'PLAN_TIER_CHANGE_FAILED: child %', v_req.child_id;
  END IF;

  UPDATE public.plan_change_requests
  SET status = 'approved',
      reviewed_at = now(),
      reviewed_by = p_admin_user_id,
      approved_plan_applied_at = now(),
      updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.admin_audit_log (
    admin_user_id,
    admin_email,
    action,
    target_user_id,
    child_id
  )
  VALUES (
    p_admin_user_id,
    p_admin_email,
    'plan_change_request_approved',
    v_req.parent_user_id,
    v_req.child_id
  );

  RETURN QUERY
    SELECT true, NULL::TEXT, v_req.child_id, v_actual_tier, v_req.requested_tier;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_approve_plan_change_request(UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_approve_plan_change_request(UUID, TEXT, UUID)
  TO service_role;
