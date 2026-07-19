-- 1. 확장팩 구매 이력 테이블 생성
CREATE TABLE public.insight_extension_purchases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    years_purchased int NOT NULL CHECK (years_purchased >= 1 AND years_purchased <= 9),
    consented_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. RLS 활성화 및 권한 부여 (GEMINI.md 규칙 준수)
ALTER TABLE public.insight_extension_purchases ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.insight_extension_purchases TO anon, authenticated;

-- 3. 정책 생성 (service_role 전용 또는 owner_parent/parent 조회)
CREATE POLICY "insight_extension_purchases_select"
  ON public.insight_extension_purchases FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.family_members fm
      WHERE fm.family_id = insight_extension_purchases.family_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );

-- 4. 구매 처리 RPC (원자적 트랜잭션)
CREATE OR REPLACE FUNCTION public.purchase_insight_extension(
    p_family_id uuid,
    p_years_to_purchase int
) RETURNS void AS $$
DECLARE
    v_current_years int;
BEGIN
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

-- RPC 실행 권한 부여
GRANT EXECUTE ON FUNCTION public.purchase_insight_extension TO authenticated;
