-- Care Insight 플랜 (Tier 2) 보존기간 연장팩 확장 (최대 9년)
CREATE TABLE public.insight_retention_extensions (
    family_id uuid PRIMARY KEY REFERENCES public.families(id) ON DELETE CASCADE,
    extension_years_purchased integer NOT NULL DEFAULT 0 CHECK (extension_years_purchased >= 0 AND extension_years_purchased <= 9),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- GEMINI.md 규칙 준수: 익명/인증 유저에게 권한 부여
GRANT ALL ON public.insight_retention_extensions TO anon, authenticated;

-- Care Premium 플랜 (Tier 3) 보존기간 선택형 컬럼 (1년, 3년, 5년 중 택1, 기본 5년)
ALTER TABLE public.families
ADD COLUMN premium_retention_years integer NOT NULL DEFAULT 5 CHECK (premium_retention_years IN (1, 3, 5));
