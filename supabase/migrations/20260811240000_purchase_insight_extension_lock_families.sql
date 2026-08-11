-- Gate① review of 20260811230000 (apply_plan_tier_change) flagged that
-- purchase_insight_extension UPSERTs insight_retention_extensions without any
-- lock, so a concurrent plan tier change could read the pack-count before this
-- purchase commits, undercounting retention. apply_plan_tier_change now takes
-- FOR UPDATE on the families row before reading premium_retention_years; this
-- migration makes purchase_insight_extension take the same lock first, so the
-- two RPCs serialize on the same families row regardless of which runs first
-- (an advisory lock alone would not have covered the case where the
-- insight_retention_extensions row does not exist yet, since there is nothing
-- to lock via FOR SHARE/FOR UPDATE on that table until the row is inserted).

CREATE OR REPLACE FUNCTION public.purchase_insight_extension(
    p_family_id uuid,
    p_years_to_purchase int
) RETURNS void AS $$
DECLARE
    v_current_years int;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.family_members fm
            WHERE fm.family_id = p_family_id
              AND fm.user_id = auth.uid()
              AND fm.role IN ('owner_parent', 'parent')
              AND fm.deleted_at IS NULL
        ) THEN
            RAISE EXCEPTION 'Forbidden: not authorized for this family';
        END IF;
    END IF;

    -- Serialize against apply_plan_tier_change (20260811230000), which locks
    -- this same row before computing retention from extension_years_purchased.
    PERFORM 1 FROM public.families WHERE id = p_family_id FOR UPDATE;

    SELECT COALESCE((SELECT extension_years_purchased FROM public.insight_retention_extensions WHERE family_id = p_family_id), 0)
    INTO v_current_years;

    IF v_current_years + p_years_to_purchase > 9 THEN
        RAISE EXCEPTION 'Maximum extension years (9) exceeded.';
    END IF;

    INSERT INTO public.insight_extension_purchases (family_id, years_purchased)
    VALUES (p_family_id, p_years_to_purchase);

    INSERT INTO public.insight_retention_extensions (family_id, extension_years_purchased)
    VALUES (p_family_id, p_years_to_purchase)
    ON CONFLICT (family_id)
    DO UPDATE SET
        extension_years_purchased = insight_retention_extensions.extension_years_purchased + EXCLUDED.extension_years_purchased,
        updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
