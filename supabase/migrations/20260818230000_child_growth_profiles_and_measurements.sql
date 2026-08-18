-- 요청서 012 「우리 아이 성장정보 v1」 — 부모 전용 키·몸무게 기록과 성장 전용 생년월일.
--
-- [설계 근거]
-- 1. 생년월일을 child_profiles 에 직접 추가하지 않는다. 기존 child_profiles_select 정책이
--    같은 가족 구성원(아이 role 포함) 조회를 허용하므로, 컬럼을 추가하면 아이 계정이
--    REST 로 생년월일을 읽을 수 있다. 성장정보는 부모 전용으로 확정됐으므로(요청서 §3-3)
--    생년월일도 성장정보 경계 안에서 parent-only RLS 로 보호한다.
-- 2. 성별 Source of Truth 는 기존 child_profiles.gender 를 계속 쓰고 중복 저장하지 않는다.
-- 3. 키·몸무게 현재값도 어디에도 중복 저장하지 않는다. growth_measurements 의 측정일 기준
--    최신 non-null 값에서 파생한다(요청서 §3-3, §3-11).
-- 4. 같은 아이·같은 측정일은 한 행이다. 키만 먼저 넣고 나중에 몸무게를 넣으면 UPDATE 한다
--    (UNIQUE(child_id, measured_at) 로 강제).
-- 5. RLS 는 owner_parent / parent 만 허용한다. 아이 role 은 SELECT 포함 전부 거부다.
--    정책 표현은 기존 parent_questions_access(20260716000000_rls_parent_only_role_guard.sql)를
--    그대로 따르되, 탈퇴·삭제된 가족 구성원이 남아 접근하지 못하도록 deleted_at 조건을 더한다.
-- 6. 허용 범위 CHECK 는 성장 판정용이 아니라 명백한 입력 실수(단위 혼동, 오타)만 막는
--    넓은 범위다(요청서 §3-4).

-- ── child_growth_profiles ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.child_growth_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL UNIQUE REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  birth_date DATE NOT NULL,
  growth_consent_version TEXT NOT NULL,
  growth_consent_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.child_growth_profiles IS
  '성장정보 전용 아이 프로필 (생년월일 Source of Truth, 성장정보 동의 이력). 부모 전용. 요청서 012';
COMMENT ON COLUMN public.child_growth_profiles.growth_consent_version IS
  '동의 시점의 성장정보 수집·이용 동의 버전 (lib/growth/consent.ts GROWTH_CONSENT_VERSION)';

-- ── growth_measurements ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growth_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  measured_at DATE NOT NULL,
  height_cm NUMERIC(4,1) NULL,
  weight_kg NUMERIC(4,1) NULL,
  source TEXT NOT NULL DEFAULT 'parent_manual',
  standard_version TEXT NOT NULL DEFAULT 'KDCA_2017',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT growth_measurements_child_measured_at_key UNIQUE (child_id, measured_at),
  CONSTRAINT growth_measurements_source_check
    CHECK (source IN ('parent_manual')),
  CONSTRAINT growth_measurements_value_present
    CHECK (height_cm IS NOT NULL OR weight_kg IS NOT NULL),
  CONSTRAINT growth_measurements_height_range
    CHECK (height_cm IS NULL OR (height_cm >= 30 AND height_cm <= 250)),
  CONSTRAINT growth_measurements_weight_range
    CHECK (weight_kg IS NULL OR (weight_kg >= 2 AND weight_kg <= 200))
);

-- 미래 날짜(생년월일·측정일) 차단은 CHECK 로 걸 수 없다 — now() 는 IMMUTABLE 이 아니어서
-- Postgres 가 CHECK 제약에 허용하지 않는다. KST 기준 미래 날짜 검증은 서버 라우트에서
-- 수행한다(lib/growth/age.ts isFutureDate, app/api/parent/growth/*).

COMMENT ON TABLE public.growth_measurements IS
  '부모가 직접 입력한 아이 키·몸무게 측정 원본. 현재값·BMI·백분위는 저장하지 않고 여기서 파생한다. 요청서 012';
COMMENT ON COLUMN public.growth_measurements.source IS
  'v1 은 parent_manual 만 허용한다. 케이 대화 자동 추출(k_conversation_confirmed 등)은 v1 범위 밖.';
COMMENT ON COLUMN public.growth_measurements.standard_version IS
  '기록 시점에 적용한 공식 성장도표 기준 (lib/growth GROWTH_STANDARD_VERSION)';

CREATE INDEX IF NOT EXISTS growth_measurements_child_id_measured_at_idx
  ON public.growth_measurements (child_id, measured_at DESC);

-- ── updated_at 자동 갱신 ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_growth_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_child_growth_profiles_updated_at ON public.child_growth_profiles;
CREATE TRIGGER trg_child_growth_profiles_updated_at
  BEFORE UPDATE ON public.child_growth_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_growth_updated_at();

DROP TRIGGER IF EXISTS trg_growth_measurements_updated_at ON public.growth_measurements;
CREATE TRIGGER trg_growth_measurements_updated_at
  BEFORE UPDATE ON public.growth_measurements
  FOR EACH ROW EXECUTE FUNCTION public.set_growth_updated_at();

-- ── RLS: owner_parent / parent 전용 ────────────────────────────
ALTER TABLE public.child_growth_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_measurements ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.child_growth_profiles TO anon, authenticated;
GRANT ALL ON public.growth_measurements TO anon, authenticated;

DROP POLICY IF EXISTS "child_growth_profiles_parent_access" ON public.child_growth_profiles;
CREATE POLICY "child_growth_profiles_parent_access"
  ON public.child_growth_profiles FOR ALL
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.child_profiles cp
      JOIN public.family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = child_growth_profiles.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
        AND fm.deleted_at IS NULL
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.child_profiles cp
      JOIN public.family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = child_growth_profiles.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
        AND fm.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "growth_measurements_parent_access" ON public.growth_measurements;
CREATE POLICY "growth_measurements_parent_access"
  ON public.growth_measurements FOR ALL
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.child_profiles cp
      JOIN public.family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = growth_measurements.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
        AND fm.deleted_at IS NULL
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.child_profiles cp
      JOIN public.family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = growth_measurements.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
        AND fm.deleted_at IS NULL
    )
  );
