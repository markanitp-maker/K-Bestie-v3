-- 목적: purchase_insight_extension 함수의 IDOR 취약점 해결
-- 기존에는 SECURITY DEFINER로 선언되어 RLS를 우회하면서도 함수 내에서 인자로 받은 p_family_id에 대해
-- 호출자(auth.uid())가 접근 권한(해당 가족의 owner_parent 또는 parent)이 있는지 검증하는 로직이 없었음.
-- 이로 인해 로그인한 모든 사용자가 임의의 family_id를 조작할 수 있는 심각한 IDOR 문제가 존재.
--
-- 변경사항:
-- 함수 시작 부분에 auth.role() = 'service_role'이 아닌 경우, family_members 테이블을 조회하여
-- p_family_id와 auth.uid(), role ('owner_parent', 'parent')을 검증하는 로직 추가.
-- 실패 시 'Forbidden: not authorized for this family' 예외를 발생시키도록 함.

CREATE OR REPLACE FUNCTION public.purchase_insight_extension(
    p_family_id uuid,
    p_years_to_purchase int
) RETURNS void AS $$
DECLARE
    v_current_years int;
BEGIN
    -- [보안 검증] 서비스 롤이 아닌 경우, 호출자가 해당 가족의 부모(owner_parent/parent)인지 확인 (IDOR 방어)
    IF auth.role() != 'service_role' THEN
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
