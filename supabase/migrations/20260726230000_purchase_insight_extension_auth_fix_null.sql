-- Fix for purchase_insight_extension SQL NULL handling
-- The previous migration checked `IF auth.role() != 'service_role' THEN`
-- However, if auth.role() is NULL (e.g., malformed JWT or missing claim),
-- the condition evaluates to NULL, which acts as FALSE, bypassing the check (fail-open).
-- This migration updates the check to use IS DISTINCT FROM to properly handle NULLs.

CREATE OR REPLACE FUNCTION public.purchase_insight_extension(
    p_family_id uuid,
    p_years_to_purchase int
) RETURNS void AS $$
DECLARE
    v_current_years int;
BEGIN
    -- [보안 검증] 서비스 롤이 아닌 경우 (NULL 포함), 호출자가 해당 가족의 부모(owner_parent/parent)인지 확인
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.family_members fm
            WHERE fm.family_id = p_family_id
              AND fm.user_id = auth.uid()
              AND fm.role IN ('owner_parent', 'parent')
        ) THEN
            RAISE EXCEPTION 'Forbidden: not authorized for this family';
        END IF;
    END IF;

    -- 현재 연장팩 년수 조회 (없으면 0)
    SELECT COALESCE((SELECT extension_years_purchased FROM public.insight_retention_extensions WHERE family_id = p_family_id), 0)
    INTO v_current_years;

    -- 9년 초과 검증 (기본 3년 + 9년 = 최대 12년)
    IF v_current_years + p_years_to_purchase > 9 THEN
        RAISE EXCEPTION 'Maximum extension years (9) exceeded.';
    END IF;

    -- 구매 이력 INSERT
    INSERT INTO public.insight_extension_purchases (family_id, years_purchased)
    VALUES (p_family_id, p_years_to_purchase);

    -- 카운터 UPSERT
    INSERT INTO public.insight_retention_extensions (family_id, extension_years_purchased)
    VALUES (p_family_id, p_years_to_purchase)
    ON CONFLICT (family_id)
    DO UPDATE SET 
        extension_years_purchased = insight_retention_extensions.extension_years_purchased + EXCLUDED.extension_years_purchased,
        updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
